/**
 * What is on the home timeline, read from D1 (docs/FEED.md "What is on it"). Used by the KV build
 * (src/lib/feed/jobs.ts), the public /timeline endpoint and the Timeline screen.
 *
 * On it: every live post (LIVE_SQL) of the locale whose show_on_timeline is not off and that is on the
 * main site (staff posts, and scholar posts editors featured: src/lib/scholars/main-site.ts), and every
 * video entry for the locale (or 'all') whose snapshot is public; minus hidden entries. Pinned
 * entries (pin_rank set) come first, by pin_rank; the rest by date, newest first.
 */
import { trimSlash, type Env } from "../../env.ts";
import { postSummaries, POST_SUMMARY_COLS, snapshotOf, toIso } from "../../routes/public-api.ts";
import { LIVE_SQL } from "../schedule.ts";
import { mainSiteSql } from "../scholars/main-site.ts";
import { compareItems, compareSort, MAX_POST_VIDEOS, type FeedItem, type FeedLocale, type FeedVideo } from "./model.ts";

type Row = Record<string, unknown>;

const P = (sql: string) => sql.replace(/\b(status|publish_at)\b/g, "p.$1");
/** Live posts of ?1 on the timeline, joined to their overrides (alias te). */
const POST_FROM = `FROM posts p LEFT JOIN timeline_entries te ON te.kind = 'post' AND te.post_id = p.id
   WHERE p.locale = ?1 AND ${P(LIVE_SQL)} AND coalesce(p.show_on_timeline, 1) NOT IN (0, '0', 'false') AND ${mainSiteSql("p")} AND coalesce(te.hidden, 0) = 0`;
const POST_DATE = "coalesce(p.published_at, p.created_at)";
/** Video entries for ?1 with a public snapshot (alias te, vs). */
const VIDEO_FROM = `FROM timeline_entries te JOIN video_snapshots vs ON vs.kind = te.video_kind AND vs.ref_id = te.ref_id
   WHERE te.kind = 'video' AND te.hidden = 0 AND (te.locale = ?1 OR te.locale = 'all')
     AND json_valid(vs.snapshot) AND coalesce(json_extract(vs.snapshot, '$.public'), 1) IS NOT 0`;
const VIDEO_DATE = "coalesce(te.entry_date, te.created_at)";

export const VIDEO_LINE = /^::video\[([A-Za-z0-9_-]{1,64})\]\s*$/gm;

/** Video ids embedded in a markdown body (`::video[ID]` lines), in order, de-duplicated. */
export function bodyVideoIds(body: unknown, max = MAX_POST_VIDEOS): string[] {
   if (typeof body !== "string" || !body.includes("::video[")) return [];
   const out: string[] = [];
   for (const m of body.matchAll(VIDEO_LINE)) {
      if (!out.includes(m[1])) out.push(m[1]);
      if (out.length >= max) break;
   }
   return out;
}

export interface Selection {
   /** Only pinned (true) or only unpinned (false) items. */
   pinned: boolean;
   /** Unpinned items dated in [from, to). */
   range?: [string, string];
   /** Unpinned items strictly older than this sort position. */
   before?: { iso: string; key: string };
   limit?: number;
}

export function where(sel: Selection, date: string, type: "p" | "v", base: number): { sql: string; binds: unknown[] } {
   const parts = [sel.pinned ? "te.pin_rank IS NOT NULL" : "te.pin_rank IS NULL"];
   const binds: unknown[] = [];
   const bind = (v: unknown) => {
      binds.push(v);
      return `?${base + binds.length}`;
   };
   if (sel.range) parts.push(`${date} >= ${bind(sel.range[0])} AND ${date} < ${bind(sel.range[1])}`);
   if (sel.before) {
      // Same order as compareSort: date desc, then "v" before "p", then id desc.
      const cType = sel.before.key[0];
      const id = type === "p" ? "p.id" : "te.id";
      if (cType === type) {
         const d = bind(sel.before.iso);
         parts.push(`(${date} < ${d} OR (${date} = ${d} AND ${id} < ${bind(Number(sel.before.key.slice(1)))}))`);
      } else if (cType === "v") parts.push(`${date} <= ${bind(sel.before.iso)}`); // posts at the same instant sort after any video
      else parts.push(`${date} < ${bind(sel.before.iso)}`);
   }
   return { sql: ` AND ${parts.join(" AND ")}`, binds };
}

/**
 * Rows → feed items (covers, card faces, body videos and their snapshots), in row order (posts first).
 * Video rows have timeline_entries' columns (id, video_kind, ref_id, entry_date, created_at, pin_rank,
 * title_override) plus the snapshot; list pages (src/lib/lists.ts) map their own rows to that shape.
 */
export async function toItems(env: Env, posts: Row[], videos: Row[]): Promise<FeedItem[]> {
   const videosWebUrl = trimSlash(env.VIDEOS_WEB_URL);
   const summaries = await postSummaries(env, posts);
   const refs = new Set<string>();
   const bodyIds = posts.map((r) => bodyVideoIds(r.body));
   for (const ids of bodyIds) for (const id of ids) refs.add(id);
   const snaps = await snapshotsFor(env.DB, [...refs]);
   const out: FeedItem[] = [];
   posts.forEach((r, i) => {
      const s = summaries[i] as Row;
      const videos: FeedVideo[] = bodyIds[i].map((id) => {
         const raw = snaps.get(id);
         const snap = raw ? snapshotOf(raw, { videosWebUrl, kind: "video", refId: id }) : null;
         return { kind: "video", ref_id: id, snapshot: snap };
      });
      // A video that is no longer public is left out (the post page skips it the same way).
      const visible = videos.filter((v) => !(snaps.get(v.ref_id) && snaps.get(v.ref_id)!.public === false));
      out.push({ key: `p${Number(r.id)}`, type: "post", date: String(s.published_at), pinned: r.pin_rank !== null && r.pin_rank !== undefined, post: { ...s, videos: visible } });
   });
   for (const r of videos) {
      let raw: Row | null;
      try {
         raw = typeof r.snapshot === "string" ? (JSON.parse(r.snapshot) as Row) : null;
      } catch {
         raw = null;
      }
      const kind = r.video_kind === "playlist" ? "playlist" : r.video_kind === "channel" ? "channel" : "video";
      const snapshot = snapshotOf(raw, { videosWebUrl, kind, refId: String(r.ref_id) });
      if (!snapshot) continue;
      const date = toIso(r.entry_date) ?? toIso(r.created_at) ?? new Date(0).toISOString();
      out.push({
         key: `v${Number(r.id)}`,
         type: "video",
         date,
         pinned: r.pin_rank !== null && r.pin_rank !== undefined,
         video: { kind, ref_id: String(r.ref_id), snapshot, title_override: typeof r.title_override === "string" && r.title_override ? r.title_override : null },
      });
   }
   return out;
}

async function snapshotsFor(db: D1Database, ids: string[]): Promise<Map<string, Row>> {
   const out = new Map<string, Row>();
   for (let i = 0; i < ids.length; i += 90) {
      const part = ids.slice(i, i + 90);
      const { results } = await db
         .prepare(`SELECT ref_id, snapshot FROM video_snapshots WHERE kind = 'video' AND ref_id IN (${part.map((_, j) => `?${j + 1}`).join(",")})`)
         .bind(...part)
         .all<{ ref_id: string; snapshot: string | null }>();
      for (const r of results) {
         try {
            const s = r.snapshot ? (JSON.parse(r.snapshot) as Row) : null;
            if (s) out.set(r.ref_id, s);
         } catch {
            /* skip a malformed row */
         }
      }
   }
   return out;
}

/** Feed items of one locale matching `sel`. Pinned: by pin_rank. Otherwise newest first. */
export async function feedItems(env: Env, l: FeedLocale, sel: Selection): Promise<FeedItem[]> {
   const pw = where(sel, POST_DATE, "p", 1);
   const vw = where(sel, VIDEO_DATE, "v", 1);
   const lim = sel.limit ? ` LIMIT ${Math.max(1, Math.min(500, Math.floor(sel.limit)))}` : "";
   const order = sel.pinned ? "te.pin_rank, te.id" : undefined;
   const [posts, videos] = await Promise.all([
      env.DB.prepare(`SELECT ${POST_SUMMARY_COLS.split(", ").map((c) => `p.${c}`).join(", ")}, p.body, te.pin_rank AS pin_rank ${POST_FROM}${pw.sql} ORDER BY ${order ?? `${POST_DATE} DESC, p.id DESC`}${lim}`)
         .bind(l, ...pw.binds)
         .all<Row>(),
      env.DB.prepare(`SELECT te.*, vs.snapshot AS snapshot ${VIDEO_FROM}${vw.sql} ORDER BY ${order ?? `${VIDEO_DATE} DESC, te.id DESC`}${lim}`)
         .bind(l, ...vw.binds)
         .all<Row>(),
   ]);
   const items = await toItems(env, posts.results, videos.results);
   if (sel.pinned) {
      const rank = new Map<string, number>();
      for (const r of posts.results) rank.set(`p${Number(r.id)}`, Number(r.pin_rank));
      for (const r of videos.results) rank.set(`v${Number(r.id)}`, Number(r.pin_rank));
      return items.sort((a, b) => (rank.get(a.key) ?? 0) - (rank.get(b.key) ?? 0) || a.key.localeCompare(b.key));
   }
   items.sort(compareItems);
   return sel.limit ? items.slice(0, sel.limit) : items;
}

/** One row per item on the timeline: enough to place it (week, pinned) and to notice a change. */
export interface LiteRow {
   key: string;
   date: string;
   pinned: boolean;
   /** Changes whenever what www shows for the item may have changed. */
   ver: string;
}

export interface LiteSelection {
   /** true: pinned only; false: unpinned only; undefined: both. */
   pinned?: boolean;
   range?: [string, string];
   /** Newest N (unpinned selections). */
   limit?: number;
   /** Only these posts / video entries. */
   posts?: number[];
   entries?: number[];
}

/**
 * Items of a locale in light form (no bodies, no media): placing single items, the head's and each
 * week's change signature, and the verifier's scan. ver = the post's / entry's updated_at, the
 * override's updated_at and the snapshot's updated_at.
 */
export async function liteItems(env: Env, l: FeedLocale, sel: LiteSelection = {}): Promise<LiteRow[]> {
   const only = sel.posts || sel.entries;
   const pf = only ? (sel.posts?.length ? ` AND p.id IN (${sel.posts.map(Number).join(",")})` : " AND 0") : "";
   const vf = only ? (sel.entries?.length ? ` AND te.id IN (${sel.entries.map(Number).join(",")})` : " AND 0") : "";
   const filter = (date: string) => {
      const parts: string[] = [];
      const binds: unknown[] = [];
      if (sel.pinned === true) parts.push("te.pin_rank IS NOT NULL");
      if (sel.pinned === false) parts.push("te.pin_rank IS NULL");
      if (sel.range) {
         parts.push(`${date} >= ?2 AND ${date} < ?3`);
         binds.push(sel.range[0], sel.range[1]);
      }
      return { sql: parts.map((p) => ` AND ${p}`).join(""), binds };
   };
   const lim = sel.limit ? ` LIMIT ${Math.max(1, Math.min(500, Math.floor(sel.limit)))}` : "";
   const pfl = filter(POST_DATE);
   const vfl = filter(VIDEO_DATE);
   const [posts, videos] = await Promise.all([
      env.DB.prepare(`SELECT p.id, ${POST_DATE} AS d, te.pin_rank, coalesce(p.updated_at, '') || '|' || coalesce(te.updated_at, '') AS ver ${POST_FROM}${pf}${pfl.sql} ORDER BY ${POST_DATE} DESC, p.id DESC${lim}`)
         .bind(l, ...pfl.binds)
         .all<{ id: number; d: string; pin_rank: number | null; ver: string }>(),
      env.DB.prepare(`SELECT te.id, ${VIDEO_DATE} AS d, te.pin_rank, te.updated_at || '|' || coalesce(vs.updated_at, '') AS ver ${VIDEO_FROM}${vf}${vfl.sql} ORDER BY ${VIDEO_DATE} DESC, te.id DESC${lim}`)
         .bind(l, ...vfl.binds)
         .all<{ id: number; d: string; pin_rank: number | null; ver: string }>(),
   ]);
   const rows: LiteRow[] = [];
   for (const r of posts.results) rows.push({ key: `p${r.id}`, date: toIso(r.d) ?? new Date(0).toISOString(), pinned: r.pin_rank !== null, ver: r.ver });
   for (const r of videos.results) rows.push({ key: `v${r.id}`, date: toIso(r.d) ?? new Date(0).toISOString(), pinned: r.pin_rank !== null, ver: r.ver });
   rows.sort((a, b) => compareSort(Date.parse(a.date), a.key, Date.parse(b.date), b.key));
   return sel.limit ? rows.slice(0, sel.limit) : rows;
}

/** Change signature of a list of light rows (same order in, same signature out). */
export const liteSig = (rows: LiteRow[]) => rows.map((r) => `${r.key}@${r.date}#${r.ver}`).join("\n");
