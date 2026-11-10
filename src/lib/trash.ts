/**
 * Admin soft delete (docs/SOFT_DELETE.md, migrations/0010).
 *
 *   softDelete      an admin delete: the row moves from its table into `trash` (one D1 batch), so
 *                   every reader (public API, sitemap, home timeline, staff lists) stops seeing it.
 *                   Nothing outside D1 is touched: R2 objects, image variants, content history stay.
 *   restore         puts the row back under the same id, and republishes it (home timeline).
 *   requestPurge    "Delete permanently now": marks it for the cleanup's next run. Still restorable.
 *   purgeDue        the cleanup (cron): the ONLY code that hard-deletes. Items deleted more than
 *                   RETENTION_DAYS ago, or with a purge request, lose their row, their R2 objects,
 *                   image variants, attached media and content history. Bounded, idempotent, retried.
 *
 * Every step is written to `trash_events` (who, when, what).
 */
import type { Env } from "../env.ts";
import { markDirty } from "./feed/jobs.ts";
import { noteCommunityChange } from "./scholars/community.ts";
import { errText, log } from "./log.ts";
import { deleteVariants } from "./variants/jobs.ts";

export const TRASH_KINDS = ["posts", "pages", "nav_items", "curated_videos", "site_settings", "media", "timeline_entries", "scholars"] as const;
export type TrashKind = (typeof TRASH_KINDS)[number];
export const isTrashKind = (v: unknown): v is TrashKind => typeof v === "string" && (TRASH_KINDS as readonly string[]).includes(v);

export const RETENTION_DAYS = 30;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;
/** Items purged per cleanup run (each costs a few D1 queries and R2 calls). */
export const PURGE_BATCH = 25;
/** A claim older than this belongs to a run that died: the next run takes the item again. */
export const CLAIM_MS = 10 * 60 * 1000;
export const REASON_MAX = 500;

export class TrashError extends Error {
   constructor(
      readonly status: 400 | 403 | 404 | 409,
      readonly code: string,
   ) {
      super(code);
      this.name = "TrashError";
   }
}

export interface TrashActor {
   id: number | string | null;
   email: string | null;
}

export interface TrashRow {
   id: number;
   kind: TrashKind;
   item_id: number;
   ref: string | null;
   label: string | null;
   locale: string | null;
   data: string;
   deleted_at: string;
   deleted_by: string | null;
   deleted_by_id: number | null;
   reason: string | null;
   purge_requested_at: string | null;
   purge_requested_by: string | null;
   purging_at: string | null;
   purge_attempts: number;
   purge_error: string | null;
   parent_id: number | null;
}

type Row = Record<string, unknown>;

const actorId = (a: TrashActor) => {
   const n = Number(a.id);
   return a.id === null || a.id === undefined || !Number.isFinite(n) ? null : n;
};

export function cleanReason(v: unknown): string | null {
   if (typeof v !== "string") return null;
   const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, REASON_MAX);
   return s || null;
}

function labelOf(kind: TrashKind, row: Row): string {
   const pick = (...keys: string[]) => {
      for (const k of keys) if (typeof row[k] === "string" && row[k]) return String(row[k]);
      return "";
   };
   switch (kind) {
      case "posts":
      case "pages":
         return pick("title", "slug");
      case "nav_items":
         return pick("label", "url");
      case "curated_videos":
         return pick("title_override") || snapshotTitle(row.snapshot) || pick("ref_id");
      case "site_settings":
         return pick("site_title", "locale");
      case "media":
         return pick("path");
      case "timeline_entries":
         return pick("title_override", "ref_id");
      case "scholars":
         return pick("name_en", "name_ar", "slug");
   }
}

function snapshotTitle(v: unknown): string {
   try {
      const s = typeof v === "string" ? (JSON.parse(v) as Row) : (v as Row | null);
      return s && typeof s.title === "string" ? s.title : "";
   } catch {
      return "";
   }
}

function event(env: Env, action: string, kind: TrashKind, itemId: number, label: string | null, actor: TrashActor | null, detail?: unknown): D1PreparedStatement {
   return env.DB.prepare(
      "INSERT INTO trash_events (action, kind, item_id, label, actor_id, actor_email, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
   ).bind(action, kind, itemId, label, actor ? actorId(actor) : null, actor?.email ?? null, detail === undefined ? null : JSON.stringify(detail), new Date().toISOString());
}

/** What a change to `kind`/`id` means for the home timeline (the KV build republishes it). */
async function touchFeed(env: Env, kind: TrashKind, id: number, why: string): Promise<void> {
   if (kind === "posts") {
      await markDirty(env, [`p${id}`], why);
      // A scholar's article: its community post is hidden on delete and shown again on restore.
      await noteCommunityChange(env, [id]);
   }
   else if (kind === "timeline_entries") await markDirty(env, [`v${id}`], why);
}

/** Moves one row into the trash. Returns the trash id. */
export async function softDelete(env: Env, kind: TrashKind, id: number, actor: TrashActor, reason?: unknown, parentId: number | null = null): Promise<number> {
   if (!Number.isInteger(id) || id <= 0) throw new TrashError(404, "not_found");
   const row = await env.DB.prepare(`SELECT * FROM "${kind}" WHERE id = ?1`).bind(id).first<Row>();
   // A post's timeline row only holds overrides (pin, hidden): not an item of its own.
   if (!row || (kind === "timeline_entries" && row.kind !== "video")) throw new TrashError(404, "not_found");
   const label = labelOf(kind, row) || null;
   const ref = kind === "media" ? (typeof row.path === "string" ? row.path : null) : kind === "timeline_entries" ? `v${id}` : null;
   const locale = typeof row.locale === "string" ? row.locale : null;
   const why = cleanReason(reason);
   const at = new Date().toISOString();
   try {
      const [ins] = await env.DB.batch([
         env.DB.prepare(
            `INSERT INTO trash (kind, item_id, ref, label, locale, data, deleted_at, deleted_by, deleted_by_id, reason, parent_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) RETURNING id`,
         ).bind(kind, id, ref, label, locale, JSON.stringify(row), at, actor.email, actorId(actor), why, parentId),
         env.DB.prepare(`DELETE FROM "${kind}" WHERE id = ?1`).bind(id),
         event(env, "delete", kind, id, label, actor, why ? { reason: why } : undefined),
      ]);
      const trashId = Number((ins.results[0] as { id: number } | undefined)?.id);
      log.info("soft deleted", { kind, item_id: id, trash_id: trashId, by: actor.email, ...(parentId ? { parent_id: parentId } : {}) });
      if (kind === "pages" || kind === "posts") {
         // Its cover goes with it (hidden from the public media route too), and comes back with it.
         for (const m of await attachedMedia(env, kind, id)) await softDelete(env, "media", m.id, actor, null, trashId);
      }
      await touchFeed(env, kind, id, `${kind} deleted`);
      return trashId;
   } catch (error) {
      if (/UNIQUE/i.test(String(error))) throw new TrashError(409, "already_deleted");
      throw error;
   }
}

async function attachedMedia(env: Env, kind: "pages" | "posts", id: number): Promise<{ id: number; path: string | null }[]> {
   const { results } = await env.DB.prepare("SELECT id, path FROM media WHERE reference LIKE ?1 AND entity_id = ?2").bind(`${kind}.%`, String(id)).all<{ id: number; path: string | null }>();
   return results;
}

/** A media file by its R2 path (bknd's `DELETE /api/media/file/:name`). */
export async function softDeleteMedia(env: Env, path: string, actor: TrashActor, reason?: unknown): Promise<number> {
   const row = await env.DB.prepare("SELECT id FROM media WHERE path = ?1 ORDER BY id DESC LIMIT 1").bind(path).first<{ id: number }>();
   if (!row) throw new TrashError(404, "not_found");
   return softDelete(env, "media", Number(row.id), actor, reason);
}

/** True when `path` is the original of a media file in the trash (its variants must stay). */
export async function mediaInTrash(db: D1Database, path: string): Promise<boolean> {
   return (await db.prepare("SELECT 1 AS x FROM trash WHERE kind = 'media' AND ref = ?1 LIMIT 1").bind(path).first()) !== null;
}

export async function getTrash(db: D1Database, trashId: number): Promise<TrashRow | null> {
   return db.prepare("SELECT * FROM trash WHERE id = ?1").bind(trashId).first<TrashRow>();
}

const claimed = (t: TrashRow, now: number) => !!t.purging_at && Date.parse(t.purging_at) > now - CLAIM_MS;

/** Puts a deleted row back under its own id. 409 when its slug (or video) was taken meanwhile. */
export async function restore(env: Env, trashId: number, actor: TrashActor): Promise<{ kind: TrashKind; id: number; detached?: boolean }> {
   const t = await getTrash(env.DB, trashId);
   if (!t || !isTrashKind(t.kind)) throw new TrashError(404, "not_found");
   if (claimed(t, Date.now())) throw new TrashError(409, "purging");
   const data = JSON.parse(t.data) as Row;
   let detached = false;
   if (t.kind === "media" && data.reference && data.entity_id !== null && data.entity_id !== undefined) {
      // The cover slot was filled since (a replaced cover): it comes back as a library image.
      const taken = await env.DB.prepare("SELECT 1 AS x FROM media WHERE reference = ?1 AND entity_id = ?2 LIMIT 1").bind(data.reference, String(data.entity_id)).first();
      if (taken) {
         data.reference = null;
         data.entity_id = null;
         data.scope = null;
         detached = true;
      }
   }
   const cols = Object.keys(data).filter((k) => /^[a-z_][a-z0-9_]*$/.test(k));
   try {
      // The DELETE goes first and checks purging_at again, so a cleanup that claimed the row in
      // between makes the batch insert nothing (changes = 0 → 409 below, rolled back).
      const res = await env.DB.batch([
         env.DB.prepare("DELETE FROM trash WHERE id = ?1 AND (purging_at IS NULL OR purging_at < ?2)").bind(trashId, new Date(Date.now() - CLAIM_MS).toISOString()),
         env.DB.prepare(
            `INSERT INTO "${t.kind}" (${cols.map((c) => `"${c}"`).join(", ")}) SELECT ${cols.map((_, i) => `?${i + 2}`).join(", ")} WHERE changes() = 1`,
         ).bind(trashId, ...cols.map((c) => toSql(data[c]))),
      ]);
      if (!res[0].meta.changes) throw new TrashError(409, "purging");
      await event(env, "restore", t.kind, t.item_id, t.label, actor, detached ? { detached: true } : undefined).run();
   } catch (error) {
      if (error instanceof TrashError) throw error;
      if (/UNIQUE/i.test(String(error))) throw new TrashError(409, "conflict");
      throw error;
   }
   log.info("restored", { kind: t.kind, item_id: t.item_id, trash_id: trashId, by: actor.email, detached });
   const { results: children } = await env.DB.prepare("SELECT id FROM trash WHERE parent_id = ?1").bind(trashId).all<{ id: number }>();
   for (const child of children) {
      try {
         await restore(env, child.id, actor);
      } catch (error) {
         // The parent is back; a child that can't come back stays in the trash, listed on its own.
         await env.DB.prepare("UPDATE trash SET parent_id = NULL WHERE id = ?1").bind(child.id).run();
         log.warn("child restore failed", { trash_id: child.id, parent_id: trashId, error: errText(error) });
      }
   }
   await touchFeed(env, t.kind, t.item_id, `${t.kind} restored`);
   return { kind: t.kind, id: t.item_id, ...(detached ? { detached } : {}) };
}

function toSql(v: unknown): unknown {
   if (v === undefined) return null;
   if (typeof v === "boolean") return v ? 1 : 0;
   if (v !== null && typeof v === "object") return JSON.stringify(v);
   return v;
}

/** "Delete permanently now": the cleanup purges it on its next run. Idempotent. */
export async function requestPurge(env: Env, trashId: number, actor: TrashActor): Promise<TrashRow> {
   const t = await getTrash(env.DB, trashId);
   if (!t || !isTrashKind(t.kind)) throw new TrashError(404, "not_found");
   if (t.purge_requested_at) return t;
   const at = new Date().toISOString();
   await env.DB.batch([
      env.DB.prepare("UPDATE trash SET purge_requested_at = ?2, purge_requested_by = ?3 WHERE id = ?1 AND purge_requested_at IS NULL").bind(trashId, at, actor.email),
      event(env, "purge_requested", t.kind, t.item_id, t.label, actor),
   ]);
   log.info("purge requested", { kind: t.kind, item_id: t.item_id, trash_id: trashId, by: actor.email });
   return { ...t, purge_requested_at: at, purge_requested_by: actor.email };
}

export interface TrashListItem {
   id: number;
   kind: TrashKind;
   item_id: number;
   label: string | null;
   locale: string | null;
   deleted_at: string;
   deleted_by: string | null;
   reason: string | null;
   purge_requested_at: string | null;
   purge_requested_by: string | null;
   purge_error: string | null;
   /** Whole days until the cleanup purges it; null when it is queued for permanent deletion. */
   days_left: number | null;
}

export function daysLeft(deletedAt: string, now: number): number {
   return Math.max(0, Math.ceil((Date.parse(deletedAt) + RETENTION_MS - now) / (24 * 60 * 60 * 1000)));
}

export async function listTrash(db: D1Database, opts: { kind?: TrashKind | null; limit?: number; offset?: number; now?: number } = {}): Promise<{ items: TrashListItem[]; total: number }> {
   const now = opts.now ?? Date.now();
   const where = opts.kind ? "WHERE parent_id IS NULL AND kind = ?1" : "WHERE parent_id IS NULL";
   const binds = opts.kind ? [opts.kind] : [];
   const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
   const offset = Math.max(opts.offset ?? 0, 0);
   const [rows, count] = await db.batch([
      db
         .prepare(
            `SELECT id, kind, item_id, label, locale, deleted_at, deleted_by, reason, purge_requested_at, purge_requested_by, purge_error FROM trash ${where}
             ORDER BY deleted_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`,
         )
         .bind(...binds),
      db.prepare(`SELECT count(*) AS n FROM trash ${where}`).bind(...binds),
   ]);
   const items = (rows.results as Omit<TrashListItem, "days_left">[]).map((r) => ({ ...r, days_left: r.purge_requested_at ? null : daysLeft(r.deleted_at, now) }));
   return { items, total: Number((count.results[0] as { n: number } | undefined)?.n ?? 0) };
}

/* The cleanup: the only hard delete */

/** Removes an R2 original and its variants, unless a live media row still uses the path. */
async function dropObject(env: Env, path: string): Promise<void> {
   const live = await env.DB.prepare("SELECT 1 AS x FROM media WHERE path = ?1 LIMIT 1").bind(path).first();
   if (live) return;
   await env.MEDIA.delete(path);
   await deleteVariants(env, path);
}

/** Everything a trashed item still owns outside its trash row. Idempotent: safe to run again. */
async function purgeExternal(env: Env, t: TrashRow): Promise<void> {
   switch (t.kind) {
      case "media": {
         const path = t.ref ?? (JSON.parse(t.data) as Row).path;
         if (typeof path === "string" && path) await dropObject(env, path);
         return;
      }
      case "pages":
      case "posts": {
         // Its cover (in the trash with it), any media row still attached, then its content history.
         const { results: children } = await env.DB.prepare("SELECT * FROM trash WHERE parent_id = ?1").bind(t.id).all<TrashRow>();
         for (const child of children) {
            await purgeExternal(env, child);
            await env.DB.batch([env.DB.prepare("DELETE FROM trash WHERE id = ?1").bind(child.id), event(env, "purged", child.kind, child.item_id, child.label, null, { with: t.id })]);
         }
         for (const m of await attachedMedia(env, t.kind, t.item_id)) {
            await env.DB.prepare("DELETE FROM media WHERE id = ?1").bind(m.id).run();
            if (m.path) await dropObject(env, m.path);
         }
         await env.DB.prepare("DELETE FROM content_revisions WHERE entity = ?1 AND entity_id = ?2").bind(t.kind, t.item_id).run();
         if (t.kind === "posts") {
            await env.DB.prepare("DELETE FROM timeline_entries WHERE kind = 'post' AND post_id = ?1").bind(t.item_id).run();
            await markDirty(env, [`p${t.item_id}`], "post purged");
         }
         return;
      }
      default:
         return; // nav_items, curated_videos, site_settings, timeline_entries: the D1 row is all there is
   }
}

export interface PurgeResult {
   purged: Partial<Record<TrashKind, number>>;
   failed: Partial<Record<TrashKind, number>>;
   remaining: boolean;
}

/**
 * The cleanup run (cron). Purges up to `limit` items whose 30 days are over or whose purge an admin
 * requested (those first). Each item is claimed (purging_at) so a restore can't race it, then its
 * external copies go, then its trash row. A failure leaves the row with purge_error and the claim
 * released, and the next run retries it.
 */
export async function purgeDue(env: Env, now = Date.now(), limit = PURGE_BATCH): Promise<PurgeResult> {
   const started = Date.now();
   const cutoff = new Date(now - RETENTION_MS).toISOString();
   const stale = new Date(now - CLAIM_MS).toISOString();
   const { results } = await env.DB.prepare(
      `SELECT id FROM trash WHERE parent_id IS NULL AND (purge_requested_at IS NOT NULL OR deleted_at <= ?1) AND (purging_at IS NULL OR purging_at < ?2)
       ORDER BY purge_requested_at IS NULL, deleted_at LIMIT ?3`,
   )
      .bind(cutoff, stale, limit + 1)
      .all<{ id: number }>();
   const out: PurgeResult = { purged: {}, failed: {}, remaining: results.length > limit };
   for (const { id } of results.slice(0, limit)) {
      const t = await env.DB.prepare("UPDATE trash SET purging_at = ?2 WHERE id = ?1 AND (purging_at IS NULL OR purging_at < ?3) RETURNING *")
         .bind(id, new Date(now).toISOString(), stale)
         .first<TrashRow>();
      if (!t || !isTrashKind(t.kind)) continue;
      const why = t.purge_requested_at ? "requested" : "expired";
      try {
         await purgeExternal(env, t);
         await env.DB.batch([
            env.DB.prepare("DELETE FROM trash WHERE id = ?1").bind(t.id),
            event(env, "purged", t.kind, t.item_id, t.label, t.purge_requested_at ? { id: null, email: t.purge_requested_by } : null, { why }),
         ]);
         out.purged[t.kind] = (out.purged[t.kind] ?? 0) + 1;
      } catch (error) {
         const message = errText(error);
         out.failed[t.kind] = (out.failed[t.kind] ?? 0) + 1;
         log.error("purge failed", { kind: t.kind, item_id: t.item_id, trash_id: t.id, attempts: t.purge_attempts + 1, error: message });
         await env.DB.batch([
            env.DB.prepare("UPDATE trash SET purging_at = NULL, purge_attempts = purge_attempts + 1, purge_error = ?2 WHERE id = ?1").bind(t.id, message),
            event(env, "purge_failed", t.kind, t.item_id, t.label, null, { error: message }),
         ]).catch(() => {});
      }
   }
   const total = (o: Partial<Record<TrashKind, number>>) => Object.values(o).reduce((a, b) => a + (b ?? 0), 0);
   log.info("trash purge", { purged: out.purged, failed: out.failed, purged_total: total(out.purged), failed_total: total(out.failed), remaining: out.remaining, ms: Date.now() - started });
   return out;
}
