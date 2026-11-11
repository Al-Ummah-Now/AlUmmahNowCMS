/**
 * www list pages (docs/specs/WWW-PAGES.md): a page is a content page (blocks), a curated list (its own
 * entries, page_entries) or a filter (everything published in the CMS of some kinds). Home is not a
 * page: it is the KV feed (docs/FEED.md). Served by GET /api/public/v1/lists/:slug, from D1.
 *
 * What a filter lists:
 *   - posts: every live main-site post of the page's locale (LIVE_SQL + MAIN_SITE_SQL), by
 *     published_at; optionally only those with a tag;
 *   - videos, playlists, channels: the CMS video library (cms_videos, src/lib/library.ts) for the
 *     locale (or 'all') whose snapshot is public, by when first added. A tag matches posts only.
 * Taking an item off home leaves it here; unpublishing or deleting (posts) or deleting it from the
 * library (videos) takes it away.
 */
import type { Env } from "../env.ts";
import { POST_SUMMARY_COLS } from "../routes/public-api.ts";
import { toItems } from "./feed/source.ts";
import type { FeedItem } from "./feed/model.ts";
import { LIVE_SQL } from "./schedule.ts";
import { mainSiteSql } from "./scholars/main-site.ts";

export { ITEM_KINDS, LIST_KINDS, LIST_PAGE_SIZE, ListError, listKindOf, normalizeFilter, POST_KINDS, storedFilter, TAG_MAX, VIDEO_KINDS } from "./list-filter.ts";
export type { ItemKind, ListFilter, ListKind } from "./list-filter.ts";
import { LIST_PAGE_SIZE, POST_KINDS, VIDEO_KINDS, type ListFilter } from "./list-filter.ts";

type Row = Record<string, unknown>;
const P = (sql: string, alias = "p") => sql.replace(/\b(status|publish_at)\b/g, `${alias}.$1`);
const placeholders = (n: number, from: number) => Array.from({ length: n }, (_, i) => `?${from + i}`).join(", ");
/** Lazy: public-api.ts imports this module, so its constants are not set while this one loads. */
const postCols = () => POST_SUMMARY_COLS.split(", ").map((c) => `p.${c}`).join(", ");
/** A public snapshot: present, valid, not marked private. */
const PUBLIC_SNAP = "json_valid(vs.snapshot) AND coalesce(json_extract(vs.snapshot, '$.public'), 1) IS NOT 0";

/** The SQL parts of a filter for locale ?1 (posts and library videos), with their binds. */
function filterParts(f: ListFilter) {
   const postKinds = f.kinds.filter((k) => POST_KINDS.includes(k));
   const videoKinds = f.tag ? [] : f.kinds.filter((k) => VIDEO_KINDS.includes(k));
   const binds: unknown[] = [];
   const bind = (v: unknown) => {
      binds.push(v);
      return `?${binds.length + 1}`;
   };
   const parts: string[] = [];
   if (postKinds.length) {
      const kinds = postKinds.map(bind).join(", ");
      const tag = f.tag ? ` AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(p.tags) THEN p.tags ELSE '[]' END) WHERE value = ${bind(f.tag)})` : "";
      parts.push(
         `SELECT 'p' AS t, p.id AS id, coalesce(p.published_at, p.created_at) AS d FROM posts p
          WHERE p.locale = ?1 AND ${P(LIVE_SQL)} AND ${mainSiteSql("p")} AND coalesce(p.kind, 'article') IN (${kinds})${tag}`,
      );
   }
   if (videoKinds.length) {
      const kinds = videoKinds.map(bind).join(", ");
      parts.push(
         `SELECT 'v' AS t, cv.id AS id, cv.added_at AS d FROM cms_videos cv JOIN video_snapshots vs ON vs.kind = cv.kind AND vs.ref_id = cv.ref_id
          WHERE (cv.locale = ?1 OR cv.locale = 'all') AND cv.kind IN (${kinds}) AND ${PUBLIC_SNAP}`,
      );
   }
   return { union: parts.join(" UNION ALL "), binds };
}

export interface ListPage {
   pinned: FeedItem[];
   items: FeedItem[];
   total: number;
}

/** One page of a filter, newest first (ties: videos before posts, then id descending, as the feed). */
export async function filterItems(env: Env, l: "en" | "ar", f: ListFilter, page: number, limit = LIST_PAGE_SIZE): Promise<ListPage> {
   const { union, binds } = filterParts(f);
   if (!union) return { pinned: [], items: [], total: 0 };
   const n = binds.length + 1;
   const [count, keys] = await Promise.all([
      env.DB.prepare(`SELECT count(*) AS n FROM (${union})`).bind(l, ...binds).first<{ n: number }>(),
      env.DB.prepare(`SELECT t, id, d FROM (${union}) ORDER BY d DESC, t DESC, id DESC LIMIT ?${n + 1} OFFSET ?${n + 2}`)
         .bind(l, ...binds, limit, (page - 1) * limit)
         .all<{ t: "p" | "v"; id: number; d: string }>(),
   ]);
   const postIds = keys.results.filter((k) => k.t === "p").map((k) => Number(k.id));
   const videoIds = keys.results.filter((k) => k.t === "v").map((k) => Number(k.id));
   const [posts, videos] = await Promise.all([
      postIds.length
         ? env.DB.prepare(`SELECT ${postCols()}, p.body, NULL AS pin_rank FROM posts p WHERE p.id IN (${placeholders(postIds.length, 1)})`).bind(...postIds).all<Row>()
         : Promise.resolve({ results: [] as Row[] }),
      videoIds.length
         ? env.DB.prepare(
              `SELECT cv.id, cv.kind AS video_kind, cv.ref_id, cv.added_at AS entry_date, cv.created_at, NULL AS pin_rank, NULL AS title_override, vs.snapshot
               FROM cms_videos cv JOIN video_snapshots vs ON vs.kind = cv.kind AND vs.ref_id = cv.ref_id WHERE cv.id IN (${placeholders(videoIds.length, 1)})`,
           )
              .bind(...videoIds)
              .all<Row>()
         : Promise.resolve({ results: [] as Row[] }),
   ]);
   const items = await toItems(env, posts.results, videos.results);
   const order = new Map(keys.results.map((k, i) => [`${k.t}${k.id}`, i]));
   items.sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0));
   return { pinned: [], items, total: Number(count?.n ?? 0) };
}

/** A curated page's live entries: pinned (page 1 only, by rank), then the rest newest first, by page. */
export async function curatedItems(env: Env, pageId: number, page: number, limit = LIST_PAGE_SIZE): Promise<ListPage> {
   const POSTS = `FROM page_entries pe JOIN posts p ON pe.kind = 'post' AND p.id = pe.post_id
      WHERE pe.page_id = ?1 AND pe.hidden = 0 AND ${P(LIVE_SQL)}`;
   const VIDEOS = `FROM page_entries pe JOIN video_snapshots vs ON vs.kind = pe.video_kind AND vs.ref_id = pe.ref_id
      WHERE pe.page_id = ?1 AND pe.kind = 'video' AND pe.hidden = 0 AND ${PUBLIC_SNAP}`;
   const PDATE = "coalesce(pe.entry_date, p.published_at, p.created_at)";
   const VDATE = "coalesce(pe.entry_date, pe.created_at)";
   const union = `SELECT 'p' AS t, p.id AS id, ${PDATE} AS d, pe.pin_rank AS r ${POSTS} UNION ALL SELECT 'v', pe.id, ${VDATE}, pe.pin_rank ${VIDEOS}`;
   const [count, pins, keys] = await Promise.all([
      env.DB.prepare(`SELECT count(*) AS n FROM (${union}) WHERE r IS NULL`).bind(pageId).first<{ n: number }>(),
      page === 1 ? env.DB.prepare(`SELECT t, id FROM (${union}) WHERE r IS NOT NULL ORDER BY r, t, id`).bind(pageId).all<{ t: "p" | "v"; id: number }>() : Promise.resolve({ results: [] }),
      env.DB.prepare(`SELECT t, id FROM (${union}) WHERE r IS NULL ORDER BY d DESC, t DESC, id DESC LIMIT ?2 OFFSET ?3`)
         .bind(pageId, limit, (page - 1) * limit)
         .all<{ t: "p" | "v"; id: number }>(),
   ]);
   const all = [...pins.results, ...keys.results];
   const postIds = all.filter((k) => k.t === "p").map((k) => Number(k.id));
   const entryIds = all.filter((k) => k.t === "v").map((k) => Number(k.id));
   const [posts, videos] = await Promise.all([
      postIds.length
         ? env.DB.prepare(`SELECT ${postCols()}, p.body, pe.pin_rank FROM posts p JOIN page_entries pe ON pe.kind = 'post' AND pe.post_id = p.id AND pe.page_id = ?1 WHERE p.id IN (${placeholders(postIds.length, 2)})`)
              .bind(pageId, ...postIds)
              .all<Row>()
         : Promise.resolve({ results: [] as Row[] }),
      entryIds.length
         ? env.DB.prepare(`SELECT pe.*, vs.snapshot FROM page_entries pe JOIN video_snapshots vs ON vs.kind = pe.video_kind AND vs.ref_id = pe.ref_id WHERE pe.id IN (${placeholders(entryIds.length, 1)})`)
              .bind(...entryIds)
              .all<Row>()
         : Promise.resolve({ results: [] as Row[] }),
   ]);
   const items = await toItems(env, posts.results, videos.results);
   const byKey = new Map(items.map((i) => [i.key, i]));
   const pick = (ks: { t: string; id: number }[]) => ks.map((k) => byKey.get(`${k.t}${k.id}`)).filter((x): x is FeedItem => !!x);
   return { pinned: pick(pins.results), items: pick(keys.results), total: Number(count?.n ?? 0) };
}
