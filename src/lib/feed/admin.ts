/**
 * The Timeline screen's data (src/admin/screens/timeline.tsx): what is on the home timeline for
 * staff, including what readers don't see yet (hidden entries, scheduled posts), and the changes
 * editors make. Every change is logged (timeline_changes: who, when, before → after) and marks the
 * item dirty for the KV build (src/lib/feed/jobs.ts).
 */
import type { Env } from "../../env.ts";
import { toIso } from "../../routes/public-api.ts";
import { compareSort, isOlder, parseCursor } from "./model.ts";
import { markDirty } from "./jobs.ts";
import { softDelete } from "../trash.ts";
import { MAIN_SITE_SQL, mainSiteSql } from "../scholars/main-site.ts";

type Row = Record<string, unknown>;

export interface AdminEntry {
   key: string;
   type: "post" | "video";
   id: number;
   title: string;
   date: string;
   hidden: boolean;
   /** A video the videos site no longer serves as public (the feed leaves it out). */
   unavailable: boolean;
   pinRank: number | null;
   /** Posts: "cards" for card posts; videos: "video" | "playlist". */
   kind: string;
   /** Posts: live, or scheduled to go live at `publishAt`. */
   scheduled: boolean;
   publishAt: string | null;
   thumb: string | null;
   locale: string;
   slug?: string;
   refId?: string;
   titleOverride?: string | null;
   channel?: string | null;
}

export interface Actor {
   id: number | string | null;
   email: string | null;
}

const POSTS = `FROM posts p LEFT JOIN timeline_entries te ON te.kind = 'post' AND te.post_id = p.id
   WHERE p.locale = ?1 AND p.status = 'published' AND coalesce(p.show_on_timeline, 1) NOT IN (0, '0', 'false') AND ${mainSiteSql("p")}`;
const VIDEOS = `FROM timeline_entries te LEFT JOIN video_snapshots vs ON vs.kind = te.video_kind AND vs.ref_id = te.ref_id
   WHERE te.kind = 'video' AND (te.locale = ?1 OR te.locale = 'all')`;
const PDATE = "coalesce(p.published_at, p.created_at)";
const VDATE = "coalesce(te.entry_date, te.created_at)";

const coverPath = (path: unknown) => (typeof path === "string" && path ? `/api/public/v1/media/${path.split("/").map(encodeURIComponent).join("/")}` : null);

function snap(v: unknown): Row {
   try {
      return typeof v === "string" ? ((JSON.parse(v) as Row) ?? {}) : {};
   } catch {
      return {};
   }
}

function postEntry(r: Row, now: number): AdminEntry {
   const publishAt = toIso(r.publish_at);
   return {
      key: `p${r.id}`,
      type: "post",
      id: Number(r.id),
      title: String(r.title ?? ""),
      date: toIso(r.d) ?? new Date(0).toISOString(),
      hidden: Number(r.hidden ?? 0) === 1,
      unavailable: false,
      pinRank: r.pin_rank === null || r.pin_rank === undefined ? null : Number(r.pin_rank),
      kind: r.kind === "cards" ? "cards" : "article",
      scheduled: !!publishAt && Date.parse(publishAt) > now,
      publishAt,
      thumb: coverPath(r.cover_path),
      locale: String(r.locale),
      slug: String(r.slug),
   };
}

function videoEntry(r: Row): AdminEntry {
   const s = snap(r.snapshot);
   return {
      key: `v${r.id}`,
      type: "video",
      id: Number(r.id),
      title: String(r.title_override || s.title || r.ref_id),
      date: toIso(r.d) ?? new Date(0).toISOString(),
      hidden: Number(r.hidden ?? 0) === 1,
      unavailable: s.public === false || !r.snapshot,
      pinRank: r.pin_rank === null || r.pin_rank === undefined ? null : Number(r.pin_rank),
      kind: r.video_kind === "playlist" ? "playlist" : "video",
      scheduled: false,
      publishAt: null,
      thumb: typeof s.thumbnail_url === "string" ? s.thumbnail_url : null,
      locale: String(r.locale ?? "all"),
      refId: String(r.ref_id),
      titleOverride: typeof r.title_override === "string" ? r.title_override : null,
      channel: typeof s.channel_name === "string" ? s.channel_name : null,
   };
}

const POST_COLS = `p.id, p.title, p.slug, p.locale, p.kind, p.publish_at, ${PDATE} AS d, te.hidden, te.pin_rank,
   (SELECT m.path FROM media m WHERE m.reference = 'posts.cover' AND m.entity_id = CAST(p.id AS TEXT) ORDER BY m.id DESC LIMIT 1) AS cover_path`;

/** Pinned entries (all, in pin order) and one page of the rest, newest first, by cursor. */
export async function adminTimeline(env: Env, l: "en" | "ar", before: string | null, size = 30): Promise<{ pinned: AdminEntry[]; items: AdminEntry[]; next: string | null }> {
   const now = Date.now();
   const c = parseCursor(before);
   const cIso = c ? new Date(c.ms).toISOString() : null;
   const [pp, pv, up, uv] = await Promise.all([
      env.DB.prepare(`SELECT ${POST_COLS} ${POSTS} AND te.pin_rank IS NOT NULL`).bind(l).all<Row>(),
      env.DB.prepare(`SELECT te.*, ${VDATE} AS d, vs.snapshot ${VIDEOS} AND te.pin_rank IS NOT NULL`).bind(l).all<Row>(),
      env.DB.prepare(`SELECT ${POST_COLS} ${POSTS} AND te.pin_rank IS NULL${cIso ? ` AND ${PDATE} <= ?2` : ""} ORDER BY ${PDATE} DESC, p.id DESC LIMIT ${size + 50}`)
         .bind(l, ...(cIso ? [cIso] : []))
         .all<Row>(),
      env.DB.prepare(`SELECT te.*, ${VDATE} AS d, vs.snapshot ${VIDEOS} AND te.pin_rank IS NULL${cIso ? ` AND ${VDATE} <= ?2` : ""} ORDER BY ${VDATE} DESC, te.id DESC LIMIT ${size + 50}`)
         .bind(l, ...(cIso ? [cIso] : []))
         .all<Row>(),
   ]);
   const pinned = [...pp.results.map((r) => postEntry(r, now)), ...pv.results.map(videoEntry)].sort((a, b) => (a.pinRank ?? 0) - (b.pinRank ?? 0) || a.key.localeCompare(b.key));
   const sorted = [...up.results.map((r) => postEntry(r, now)), ...uv.results.map(videoEntry)]
      .filter((e) => !c || isOlder(e, c))
      .sort((a, b) => compareSort(Date.parse(a.date), a.key, Date.parse(b.date), b.key));
   const items = sorted.slice(0, size);
   const last = items[items.length - 1];
   return { pinned, items, next: sorted.length > size && last ? `${Date.parse(last.date)}-${last.key}` : null };
}

/** Live or scheduled posts of a locale that are NOT on the timeline (the "Add post" chooser). */
export async function offTimeline(env: Env, l: "en" | "ar", q: string, limit = 20): Promise<{ id: number; title: string; date: string; kind: string }[]> {
   const like = `%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
   const { results } = await env.DB.prepare(
      `SELECT id, title, kind, coalesce(published_at, created_at) AS d FROM posts
       WHERE locale = ?1 AND status = 'published' AND coalesce(show_on_timeline, 1) IN (0, '0', 'false') AND ${MAIN_SITE_SQL}
         AND (?2 = '%%' OR title LIKE ?2 ESCAPE '\\' OR slug LIKE ?2 ESCAPE '\\')
       ORDER BY d DESC LIMIT ?3`,
   )
      .bind(l, like, limit)
      .all<Row>();
   return results.map((r) => ({ id: Number(r.id), title: String(r.title), date: toIso(r.d) ?? "", kind: r.kind === "cards" ? "cards" : "article" }));
}

export async function logChange(env: Env, actor: Actor, action: string, key: string, locale: string | null, detail: unknown): Promise<void> {
   await env.DB.prepare(
      "INSERT INTO timeline_changes (action, entry_kind, entry_ref, locale, detail, actor_id, actor_email, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
   )
      .bind(action, key.startsWith("p") ? "post" : "video", key, locale, JSON.stringify(detail ?? null), actor.id === null || actor.id === undefined ? null : Number(actor.id), actor.email, new Date().toISOString())
      .run();
}

/** A full rebuild in the change log (who asked: a staff member, or "system/release"). */
export async function logRebuild(env: Env, actor: Actor, detail: Record<string, unknown>): Promise<void> {
   await env.DB.prepare(
      "INSERT INTO timeline_changes (action, entry_kind, entry_ref, locale, detail, actor_id, actor_email, created_at) VALUES ('rebuild', 'feed', 'all', NULL, ?1, ?2, ?3, ?4)",
   )
      .bind(JSON.stringify(detail), actor.id === null || actor.id === undefined ? null : Number(actor.id), actor.email, new Date().toISOString())
      .run();
}

export interface Change {
   id: number;
   action: string;
   entry_ref: string;
   locale: string | null;
   detail: unknown;
   actor_email: string | null;
   created_at: string;
   title: string | null;
}

export async function recentChanges(env: Env, limit = 20): Promise<Change[]> {
   const { results } = await env.DB.prepare(
      `SELECT c.*, CASE WHEN c.entry_kind = 'feed' THEN NULL WHEN c.entry_kind = 'post' THEN (SELECT title FROM posts WHERE id = CAST(substr(c.entry_ref, 2) AS INTEGER))
         ELSE (SELECT coalesce(te.title_override, json_extract(vs.snapshot, '$.title')) FROM timeline_entries te LEFT JOIN video_snapshots vs ON vs.kind = te.video_kind AND vs.ref_id = te.ref_id WHERE te.id = CAST(substr(c.entry_ref, 2) AS INTEGER)) END AS title
       FROM timeline_changes c ORDER BY c.id DESC LIMIT ?1`,
   )
      .bind(limit)
      .all<Row>();
   return results.map((r) => ({
      id: Number(r.id),
      action: String(r.action),
      entry_ref: String(r.entry_ref),
      locale: (r.locale as string | null) ?? null,
      detail: snap(r.detail),
      actor_email: (r.actor_email as string | null) ?? null,
      created_at: String(r.created_at),
      title: typeof r.title === "string" ? r.title : null,
   }));
}

/* Changes */

export class TimelineError extends Error {
   constructor(
      readonly status: 400 | 404 | 409,
      readonly code: string,
   ) {
      super(code);
   }
}

const parseKey = (key: string): { type: "p" | "v"; id: number } => {
   const m = /^([pv])(\d{1,12})$/.exec(key);
   if (!m) throw new TimelineError(400, "bad_key");
   return { type: m[1] as "p" | "v", id: Number(m[2]) };
};

async function postRow(env: Env, id: number): Promise<Row> {
   const row = await env.DB.prepare("SELECT id, locale, status FROM posts WHERE id = ?1").bind(id).first<Row>();
   if (!row) throw new TimelineError(404, "not_found");
   return row;
}

async function videoRow(env: Env, id: number): Promise<Row> {
   const row = await env.DB.prepare("SELECT * FROM timeline_entries WHERE id = ?1 AND kind = 'video'").bind(id).first<Row>();
   if (!row) throw new TimelineError(404, "not_found");
   return row;
}

/** The override row of a post, created on first use. */
async function ensurePostEntry(env: Env, postId: number, actor: Actor): Promise<void> {
   const at = new Date().toISOString();
   await env.DB.prepare(
      `INSERT INTO timeline_entries (kind, post_id, hidden, created_at, created_by, updated_at, updated_by) VALUES ('post', ?1, 0, ?2, ?3, ?2, ?3)
       ON CONFLICT (post_id) WHERE kind = 'post' DO NOTHING`,
   )
      .bind(postId, at, actor.email)
      .run();
}

async function updateEntry(env: Env, key: string, set: Record<string, unknown>, actor: Actor): Promise<void> {
   const { type, id } = parseKey(key);
   if (type === "p") {
      await postRow(env, id);
      await ensurePostEntry(env, id, actor);
   } else await videoRow(env, id);
   const cols = Object.keys(set);
   const where = type === "p" ? "kind = 'post' AND post_id = ?1" : "kind = 'video' AND id = ?1";
   await env.DB.prepare(`UPDATE timeline_entries SET ${cols.map((c, i) => `${c} = ?${i + 2}`).join(", ")}, updated_at = ?${cols.length + 2}, updated_by = ?${cols.length + 3} WHERE ${where}`)
      .bind(id, ...cols.map((c) => set[c]), new Date().toISOString(), actor.email)
      .run();
}

export async function setHidden(env: Env, key: string, hidden: boolean, actor: Actor): Promise<void> {
   await updateEntry(env, key, { hidden: hidden ? 1 : 0 }, actor);
   await logChange(env, actor, hidden ? "hide" : "show", key, null, { hidden });
   await markDirty(env, [key], hidden ? "hidden" : "shown");
}

/** Pin (appended after the current pins) or unpin. */
export async function setPinned(env: Env, key: string, pinned: boolean, actor: Actor): Promise<void> {
   let rank: number | null = null;
   if (pinned) {
      const max = await env.DB.prepare("SELECT max(pin_rank) AS m FROM timeline_entries").first<{ m: number | null }>();
      rank = Number(max?.m ?? 0) + 1;
   }
   await updateEntry(env, key, { pin_rank: rank }, actor);
   await logChange(env, actor, pinned ? "pin" : "unpin", key, null, { pin_rank: rank });
   await markDirty(env, [key], pinned ? "pinned" : "unpinned");
}

/**
 * New order of the pinned entries of a locale. `keys` must be exactly the pinned set as the editor
 * saw it (409 otherwise: someone pinned or unpinned meanwhile; reload).
 */
export async function reorderPins(env: Env, l: "en" | "ar", keys: string[], actor: Actor): Promise<void> {
   const { pinned } = await adminTimeline(env, l, null, 1);
   const current = pinned.map((e) => e.key);
   if (keys.length !== current.length || [...keys].sort().join() !== [...current].sort().join()) throw new TimelineError(409, "conflict");
   // Ranks are global (an 'all' video is pinned in both languages): keep the slots this locale
   // already uses, in the new order, so the other locale's order is untouched.
   const slots = pinned.map((e) => e.pinRank ?? 0).sort((a, b) => a - b);
   const at = new Date().toISOString();
   const stmts = keys.map((key, i) => {
      const { type, id } = parseKey(key);
      return env.DB.prepare(`UPDATE timeline_entries SET pin_rank = ?2, updated_at = ?3, updated_by = ?4 WHERE ${type === "p" ? "kind = 'post' AND post_id = ?1" : "kind = 'video' AND id = ?1"}`).bind(
         id,
         slots[i],
         at,
         actor.email,
      );
   });
   await env.DB.batch(stmts);
   await logChange(env, actor, "reorder", keys[0] ?? "p0", l, { order: keys });
   await markDirty(env, [`head:${l}`], "pins reordered");
}

export async function setVideoFields(env: Env, key: string, fields: { entry_date?: string; title_override?: string | null; locale?: string }, actor: Actor): Promise<void> {
   const { type } = parseKey(key);
   if (type !== "v") throw new TimelineError(400, "bad_key");
   const set: Record<string, unknown> = {};
   if (fields.entry_date !== undefined) {
      const d = toIso(fields.entry_date);
      if (!d) throw new TimelineError(400, "bad_date");
      set.entry_date = d;
   }
   if (fields.title_override !== undefined) set.title_override = fields.title_override ? String(fields.title_override).trim().slice(0, 200) || null : null;
   if (fields.locale !== undefined) {
      if (!["en", "ar", "all"].includes(fields.locale)) throw new TimelineError(400, "bad_locale");
      set.locale = fields.locale;
   }
   if (!Object.keys(set).length) throw new TimelineError(400, "nothing_to_change");
   const before = await videoRow(env, parseKey(key).id);
   try {
      await updateEntry(env, key, set, actor);
   } catch (error) {
      if (/UNIQUE/i.test(String(error))) throw new TimelineError(409, "duplicate");
      throw error;
   }
   await logChange(env, actor, "edit", key, null, { before: { entry_date: before.entry_date, title_override: before.title_override, locale: before.locale }, after: set });
   await markDirty(env, [key], "video entry edited");
}

/** A video picked in the CMS picker (its snapshot is already in video_snapshots). */
export async function addVideo(env: Env, v: { kind: "video" | "playlist"; ref_id: string; locale: string; entry_date: string | null }, actor: Actor): Promise<{ key: string; existing: boolean }> {
   if (!["en", "ar", "all"].includes(v.locale)) throw new TimelineError(400, "bad_locale");
   const s = await env.DB.prepare("SELECT snapshot FROM video_snapshots WHERE kind = ?1 AND ref_id = ?2").bind(v.kind, v.ref_id).first<{ snapshot: string | null }>();
   if (!s) throw new TimelineError(404, "not_found");
   const upload = toIso(snap(s.snapshot).upload_date);
   const date = (v.entry_date && toIso(v.entry_date)) || upload || new Date().toISOString();
   const at = new Date().toISOString();
   const row = await env.DB.prepare(
      `INSERT INTO timeline_entries (kind, video_kind, ref_id, locale, entry_date, hidden, created_at, created_by, updated_at, updated_by)
       VALUES ('video', ?1, ?2, ?3, ?4, 0, ?5, ?6, ?5, ?6)
       ON CONFLICT (video_kind, ref_id, locale) WHERE kind = 'video' DO NOTHING RETURNING id`,
   )
      .bind(v.kind, v.ref_id, v.locale, date, at, actor.email)
      .first<{ id: number }>();
   if (!row) {
      const existing = await env.DB.prepare("SELECT id FROM timeline_entries WHERE kind = 'video' AND video_kind = ?1 AND ref_id = ?2 AND locale = ?3").bind(v.kind, v.ref_id, v.locale).first<{ id: number }>();
      return { key: `v${existing?.id ?? 0}`, existing: true };
   }
   const key = `v${row.id}`;
   await logChange(env, actor, "add", key, v.locale, { kind: v.kind, ref_id: v.ref_id, entry_date: date });
   await markDirty(env, [key], "video added");
   return { key, existing: false };
}

export async function removeVideo(env: Env, key: string, actor: Actor, reason?: unknown): Promise<void> {
   const { type, id } = parseKey(key);
   if (type !== "v") throw new TimelineError(400, "bad_key");
   const before = await videoRow(env, id);
   // A soft delete (docs/SOFT_DELETE.md): the entry moves to the trash (restorable for 30 days) and
   // the timeline is rebuilt without it. feed_items still records where it lived, so the build
   // knows which week to rewrite.
   await softDelete(env, "timeline_entries", id, actor, reason);
   await logChange(env, actor, "remove", key, String(before.locale ?? "all"), { kind: before.video_kind, ref_id: before.ref_id, entry_date: before.entry_date });
}

/**
 * A post on or off the timeline = its "Show on home timeline" field (the post editor shows the same
 * switch). Written through bknd (`write`), so the post's history records it and the feed plugin
 * marks it dirty. Turning a post off also clears its pin.
 */
export async function setPostOnTimeline(env: Env, postId: number, on: boolean, actor: Actor, write: (id: number, on: boolean) => Promise<void>): Promise<void> {
   await postRow(env, postId);
   await write(postId, on);
   if (!on) await env.DB.prepare("UPDATE timeline_entries SET pin_rank = NULL, hidden = 0, updated_at = ?2, updated_by = ?3 WHERE kind = 'post' AND post_id = ?1").bind(postId, new Date().toISOString(), actor.email).run();
   await logChange(env, actor, on ? "add" : "remove", `p${postId}`, null, { show_on_timeline: on });
   await markDirty(env, [`p${postId}`], on ? "post added" : "post removed");
}
