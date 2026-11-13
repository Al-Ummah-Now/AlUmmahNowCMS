/**
 * A curated page's list (docs/specs/WWW-PAGES.md): the same editor and mechanics as home's timeline
 * (src/lib/feed/admin.ts), stored in page_entries. Unlike home, posts do not join on their own: a
 * page lists what editors added. Keys match the Timeline screen's client: "p<post id>" for posts and
 * "v<entry id>" for videos, so src/admin/client/timeline.ts drives both.
 *
 * Every change is logged in timeline_changes with detail.page_id (and the item's title), and removing
 * an entry is a soft delete (trash kind page_entries, restorable for 30 days). A video added here also
 * joins the CMS video library (src/lib/library.ts).
 */
import { trimSlash, type Env } from "../env.ts";
import { stableImageUrl } from "./stable-thumb.ts";
import { toIso } from "../routes/public-api.ts";
import { coverPath, TimelineError, type Actor, type AdminEntry } from "./feed/admin.ts";
import { addToLibrary } from "./library.ts";
import { softDelete } from "./trash.ts";

type Row = Record<string, unknown>;
export const MAX_PAGE_ENTRIES = 500;

export interface ListPageRow {
   id: number;
   slug: string;
   locale: "en" | "ar";
   title: string;
   list_kind: string | null;
}

/** A page that is a curated list (404 otherwise). */
export async function curatedPage(env: Env, id: number): Promise<ListPageRow> {
   const row = await env.DB.prepare("SELECT id, slug, locale, title, list_kind FROM pages WHERE id = ?1").bind(id).first<Row>();
   if (!row || row.list_kind !== "curated") throw new TimelineError(404, "not_found");
   return { id: Number(row.id), slug: String(row.slug), locale: row.locale === "ar" ? "ar" : "en", title: String(row.title ?? ""), list_kind: "curated" };
}

const parseKey = (key: string): { type: "p" | "v"; id: number } => {
   const m = /^([pv])(\d{1,12})$/.exec(key);
   if (!m) throw new TimelineError(400, "bad_key");
   return { type: m[1] as "p" | "v", id: Number(m[2]) };
};
const where = (type: "p" | "v") => (type === "p" ? "page_id = ?1 AND kind = 'post' AND post_id = ?2" : "page_id = ?1 AND kind = 'video' AND id = ?2");

function snap(v: unknown): Row {
   try {
      return typeof v === "string" ? ((JSON.parse(v) as Row) ?? {}) : {};
   } catch {
      return {};
   }
}

/** Every entry of a page, for the editor: pinned (by rank), then the rest newest first. */
export async function pageList(env: Env, page: ListPageRow): Promise<{ pinned: AdminEntry[]; items: AdminEntry[] }> {
   const now = Date.now();
   const videosWebUrl = trimSlash(env.VIDEOS_WEB_URL);
   const { results } = await env.DB.prepare(
      `SELECT pe.*, p.title AS post_title, p.slug AS post_slug, p.kind AS post_kind, p.publish_at, p.status,
              coalesce(pe.entry_date, p.published_at, p.created_at) AS d, vs.snapshot,
              (SELECT m.path FROM media m WHERE m.reference = 'posts.cover' AND m.entity_id = CAST(p.id AS TEXT) ORDER BY m.id DESC LIMIT 1) AS cover_path
       FROM page_entries pe
       LEFT JOIN posts p ON pe.kind = 'post' AND p.id = pe.post_id
       LEFT JOIN video_snapshots vs ON pe.kind = 'video' AND vs.kind = pe.video_kind AND vs.ref_id = pe.ref_id
       WHERE pe.page_id = ?1 AND (pe.kind = 'video' OR p.id IS NOT NULL)
       LIMIT ${MAX_PAGE_ENTRIES}`,
   )
      .bind(page.id)
      .all<Row>();
   const entries = results.map((r): AdminEntry => {
      const pinRank = r.pin_rank === null || r.pin_rank === undefined ? null : Number(r.pin_rank);
      const date = toIso(r.d) ?? toIso(r.created_at) ?? new Date(0).toISOString();
      if (r.kind === "post") {
         const publishAt = toIso(r.publish_at);
         return {
            key: `p${r.post_id}`,
            type: "post",
            id: Number(r.post_id),
            title: String(r.post_title ?? ""),
            date,
            hidden: Number(r.hidden) === 1,
            // A post unpublished since it was added: listed for staff, not shown on www.
            unavailable: r.status !== "published",
            pinRank,
            kind: r.post_kind === "cards" ? "cards" : "article",
            scheduled: !!publishAt && Date.parse(publishAt) > now,
            publishAt,
            thumb: coverPath(r.cover_path),
            locale: page.locale,
            slug: String(r.post_slug ?? ""),
         };
      }
      const s = snap(r.snapshot);
      return {
         key: `v${r.id}`,
         type: "video",
         id: Number(r.id),
         title: String(r.title_override || s.title || r.ref_id),
         date,
         hidden: Number(r.hidden) === 1,
         unavailable: s.public === false || !r.snapshot,
         pinRank,
         kind: r.video_kind === "playlist" ? "playlist" : r.video_kind === "channel" ? "channel" : "video",
         scheduled: false,
         publishAt: null,
         thumb: stableImageUrl(videosWebUrl, typeof s.thumbnail_url === "string" ? s.thumbnail_url : null, r.video_kind === "video" ? String(r.ref_id) : null),
         locale: page.locale,
         refId: String(r.ref_id),
         titleOverride: typeof r.title_override === "string" ? r.title_override : null,
         channel: typeof s.channel_name === "string" ? s.channel_name : null,
      };
   });
   const pinned = entries.filter((e) => e.pinRank !== null).sort((a, b) => (a.pinRank ?? 0) - (b.pinRank ?? 0) || a.key.localeCompare(b.key));
   const items = entries.filter((e) => e.pinRank === null).sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || b.key.localeCompare(a.key));
   return { pinned, items };
}

async function log(env: Env, page: ListPageRow, actor: Actor, action: string, key: string, detail: Row): Promise<void> {
   await env.DB.prepare(
      "INSERT INTO timeline_changes (action, entry_kind, entry_ref, locale, detail, actor_id, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
   )
      .bind(action, key.startsWith("p") ? "post" : "video", key, page.locale, JSON.stringify({ ...detail, page_id: page.id }), actor.id === null || actor.id === undefined ? null : Number(actor.id), actor.email, new Date().toISOString())
      .run();
}

async function entryTitle(env: Env, page: ListPageRow, key: string): Promise<string | null> {
   const { type, id } = parseKey(key);
   const r =
      type === "p"
         ? await env.DB.prepare("SELECT title FROM posts WHERE id = ?1").bind(id).first<Row>()
         : await env.DB.prepare(
              "SELECT coalesce(pe.title_override, json_extract(vs.snapshot, '$.title'), pe.ref_id) AS title FROM page_entries pe LEFT JOIN video_snapshots vs ON vs.kind = pe.video_kind AND vs.ref_id = pe.ref_id WHERE pe.page_id = ?1 AND pe.id = ?2",
           )
              .bind(page.id, id)
              .first<Row>();
   return typeof r?.title === "string" ? r.title : null;
}

/** Published posts of the page's language not on it yet (the "Add a post" chooser; newest first with no query). */
export async function pageCandidates(env: Env, page: ListPageRow, q: string, limit = 20): Promise<{ id: number; title: string; date: string; kind: string }[]> {
   const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
   const { results } = await env.DB.prepare(
      `SELECT id, title, kind, coalesce(published_at, created_at) AS d FROM posts p
       WHERE p.locale = ?1 AND p.status = 'published'
         AND NOT EXISTS (SELECT 1 FROM page_entries pe WHERE pe.page_id = ?4 AND pe.kind = 'post' AND pe.post_id = p.id)
         AND (?2 = '%%' OR title LIKE ?2 ESCAPE '\\' OR slug LIKE ?2 ESCAPE '\\')
       ORDER BY d DESC LIMIT ?3`,
   )
      .bind(page.locale, like, limit, page.id)
      .all<Row>();
   return results.map((r) => ({ id: Number(r.id), title: String(r.title), date: toIso(r.d) ?? "", kind: r.kind === "cards" ? "cards" : "article" }));
}

/** Counts for the chooser's empty message (src/admin/client/timeline.ts emptyCandidates). */
export async function pageCounts(env: Env, page: ListPageRow): Promise<{ published: number; off: number }> {
   const r = await env.DB.prepare(
      `SELECT count(*) AS published, coalesce(sum(NOT EXISTS (SELECT 1 FROM page_entries pe WHERE pe.page_id = ?2 AND pe.kind = 'post' AND pe.post_id = p.id)), 0) AS off
       FROM posts p WHERE p.locale = ?1 AND p.status = 'published'`,
   )
      .bind(page.locale, page.id)
      .first<{ published: number; off: number }>();
   return { published: Number(r?.published ?? 0), off: Number(r?.off ?? 0) };
}

/** Adds a post (on = true) or removes it (on = false: a soft delete of its entry). */
export async function setPagePost(env: Env, page: ListPageRow, postId: number, on: boolean, actor: Actor): Promise<void> {
   const post = await env.DB.prepare("SELECT id, locale, title, published_at, created_at FROM posts WHERE id = ?1").bind(postId).first<Row>();
   if (!post) throw new TimelineError(404, "not_found");
   if (post.locale !== page.locale) throw new TimelineError(400, "bad_locale");
   const key = `p${postId}`;
   if (on) {
      const at = new Date().toISOString();
      const res = await env.DB.prepare(
         `INSERT INTO page_entries (page_id, kind, post_id, hidden, created_at, created_by, updated_at, updated_by) VALUES (?1, 'post', ?2, 0, ?3, ?4, ?3, ?4)
          ON CONFLICT (page_id, post_id) WHERE kind = 'post' DO NOTHING`,
      )
         .bind(page.id, postId, at, actor.email)
         .run();
      if (res.meta.changes) await log(env, page, actor, "add", key, { title: post.title });
      return;
   }
   const row = await env.DB.prepare(`SELECT id FROM page_entries WHERE ${where("p")}`).bind(page.id, postId).first<{ id: number }>();
   if (!row) throw new TimelineError(404, "not_found");
   await softDelete(env, "page_entries", row.id, actor);
   await log(env, page, actor, "remove", key, { title: post.title });
}

/** A video, playlist or channel (its snapshot is already in video_snapshots). Idempotent. */
export async function addPageVideo(env: Env, page: ListPageRow, v: { kind: "video" | "playlist" | "channel"; ref_id: string; entry_date: string | null }, actor: Actor): Promise<{ key: string; existing: boolean }> {
   const s = await env.DB.prepare("SELECT snapshot FROM video_snapshots WHERE kind = ?1 AND ref_id = ?2").bind(v.kind, v.ref_id).first<{ snapshot: string | null }>();
   if (!s) throw new TimelineError(404, "not_found");
   const sn = snap(s.snapshot);
   const date = (v.entry_date && toIso(v.entry_date)) || toIso(sn.upload_date) || new Date().toISOString();
   const at = new Date().toISOString();
   const row = await env.DB.prepare(
      `INSERT INTO page_entries (page_id, kind, video_kind, ref_id, entry_date, hidden, created_at, created_by, updated_at, updated_by)
       VALUES (?1, 'video', ?2, ?3, ?4, 0, ?5, ?6, ?5, ?6)
       ON CONFLICT (page_id, video_kind, ref_id) WHERE kind = 'video' DO NOTHING RETURNING id`,
   )
      .bind(page.id, v.kind, v.ref_id, date, at, actor.email)
      .first<{ id: number }>();
   if (!row) {
      const existing = await env.DB.prepare("SELECT id FROM page_entries WHERE page_id = ?1 AND kind = 'video' AND video_kind = ?2 AND ref_id = ?3").bind(page.id, v.kind, v.ref_id).first<{ id: number }>();
      return { key: `v${existing?.id ?? 0}`, existing: true };
   }
   await addToLibrary(env, { kind: v.kind, ref_id: v.ref_id, locale: page.locale }, `page:${page.id}`, actor);
   const key = `v${row.id}`;
   await log(env, page, actor, "add", key, { kind: v.kind, ref_id: v.ref_id, entry_date: date, title: typeof sn.title === "string" ? sn.title : v.ref_id });
   return { key, existing: false };
}

async function update(env: Env, page: ListPageRow, key: string, set: Row, actor: Actor): Promise<void> {
   const { type, id } = parseKey(key);
   const cols = Object.keys(set);
   const res = await env.DB.prepare(`UPDATE page_entries SET ${cols.map((c, i) => `${c} = ?${i + 3}`).join(", ")}, updated_at = ?${cols.length + 3}, updated_by = ?${cols.length + 4} WHERE ${where(type)}`)
      .bind(page.id, id, ...cols.map((c) => set[c]), new Date().toISOString(), actor.email)
      .run();
   if (!res.meta.changes) throw new TimelineError(404, "not_found");
}

export async function setPageHidden(env: Env, page: ListPageRow, key: string, hidden: boolean, actor: Actor): Promise<void> {
   await update(env, page, key, { hidden: hidden ? 1 : 0 }, actor);
   await log(env, page, actor, hidden ? "hide" : "show", key, { hidden, title: await entryTitle(env, page, key) });
}

export async function setPagePinned(env: Env, page: ListPageRow, key: string, pinned: boolean, actor: Actor): Promise<void> {
   let rank: number | null = null;
   if (pinned) {
      const max = await env.DB.prepare("SELECT max(pin_rank) AS m FROM page_entries WHERE page_id = ?1").bind(page.id).first<{ m: number | null }>();
      rank = Number(max?.m ?? 0) + 1;
   }
   await update(env, page, key, { pin_rank: rank }, actor);
   await log(env, page, actor, pinned ? "pin" : "unpin", key, { pin_rank: rank, title: await entryTitle(env, page, key) });
}

/** The pinned order. `keys` must be exactly the pinned set (409: someone changed it meanwhile). */
export async function reorderPagePins(env: Env, page: ListPageRow, keys: string[], actor: Actor): Promise<void> {
   const { pinned } = await pageList(env, page);
   const current = pinned.map((e) => e.key);
   if (keys.length !== current.length || [...keys].sort().join() !== [...current].sort().join()) throw new TimelineError(409, "conflict");
   const at = new Date().toISOString();
   await env.DB.batch(
      keys.map((key, i) => {
         const { type, id } = parseKey(key);
         return env.DB.prepare(`UPDATE page_entries SET pin_rank = ?3, updated_at = ?4, updated_by = ?5 WHERE ${where(type)}`).bind(page.id, id, i + 1, at, actor.email);
      }),
   );
   await log(env, page, actor, "reorder", keys[0] ?? "p0", { order: keys });
}

export async function setPageVideoFields(env: Env, page: ListPageRow, key: string, fields: { entry_date?: string; title_override?: string | null }, actor: Actor): Promise<void> {
   const { type } = parseKey(key);
   if (type !== "v") throw new TimelineError(400, "bad_key");
   const set: Row = {};
   if (fields.entry_date !== undefined) {
      const d = toIso(fields.entry_date);
      if (!d) throw new TimelineError(400, "bad_date");
      set.entry_date = d;
   }
   if (fields.title_override !== undefined) set.title_override = fields.title_override ? String(fields.title_override).trim().slice(0, 200) || null : null;
   if (!Object.keys(set).length) throw new TimelineError(400, "nothing_to_change");
   await update(env, page, key, set, actor);
   await log(env, page, actor, "edit", key, { after: set, title: await entryTitle(env, page, key) });
}

/** Soft delete of a video entry (the library keeps the video). */
export async function removePageVideo(env: Env, page: ListPageRow, key: string, actor: Actor, reason?: unknown): Promise<void> {
   const { type, id } = parseKey(key);
   if (type !== "v") throw new TimelineError(400, "bad_key");
   const title = await entryTitle(env, page, key);
   const row = await env.DB.prepare(`SELECT id FROM page_entries WHERE ${where("v")}`).bind(page.id, id).first<{ id: number }>();
   if (!row) throw new TimelineError(404, "not_found");
   await softDelete(env, "page_entries", id, actor, reason);
   await log(env, page, actor, "remove", key, { title });
}
