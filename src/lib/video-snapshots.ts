/**
 * Snapshots of videos-platform items used in page blocks (video shelves, embedded videos), keyed by
 * (kind, ref_id) and shared by every page that uses the item. Same contract as curated snapshots
 * (src/lib/snapshots.ts): taken server-side at pick time, refreshed out of band, never written by a
 * browser.
 *
 * The refresh is a queue in D1, run by the cron: each row is a job that is due when
 * `next_attempt_at` has passed. A success clears the failure state. A failure (videos API down,
 * timeout) backs off exponentially (5 min · 2^attempts, at most 6 h). After MAX_ATTEMPTS
 * consecutive failures the row is dead-lettered (`dead_at`): it is no longer retried, keeps its
 * last good snapshot, and is flagged to staff on the Overview, where Retry puts it back in the
 * queue. Every write is a compare-and-set on `updated_at`, so overlapping runs and a pick racing
 * a refresh never overwrite a newer write (the loser is picked up on the next run).
 */
import { snapshotOf, type Snapshot } from "./snapshots.ts";
import { channelVideos, lookupItem, VideosApiError, type ItemDetail, type VideoKind } from "./videos.ts";

/** A channel's newest public videos, as its snapshot keeps them (docs/specs/WWW-PAGES.md D7). */
export interface LatestVideo {
   id: string;
   title: string;
   thumbnail_url: string | null;
   duration_seconds: number | null;
}
export const CHANNEL_LATEST = 3;

/**
 * lookupItem, plus a channel's `latest` videos. The latest list is best effort: when it fails the
 * channel is still snapshotted (without `latest`), so a slow listing never makes a channel look gone.
 */
export async function lookupForSnapshot(apiUrl: string, kind: VideoKind, id: string, fetchImpl: typeof fetch = fetch): Promise<(ItemDetail & { latest?: LatestVideo[] }) | null> {
   const item = await lookupItem(apiUrl, kind, id, fetchImpl);
   if (!item || kind !== "channel") return item;
   try {
      const { items } = await channelVideos(apiUrl, id, { limit: CHANNEL_LATEST }, fetchImpl);
      return { ...item, latest: items.slice(0, CHANNEL_LATEST).map((v) => ({ id: v.id, title: v.title, thumbnail_url: v.thumbnail_url, duration_seconds: v.duration_seconds })) };
   } catch {
      return item;
   }
}

export const MAX_ATTEMPTS = 8;
export const BASE_BACKOFF_MS = 5 * 60_000;
export const MAX_BACKOFF_MS = 6 * 60 * 60_000;
/** A healthy row is refreshed again after this long (thumbnail URLs are signed for ≥ 6 h). */
export const REFRESH_AFTER_MS = 2 * 60 * 60_000;
export const BATCH = 60;
export const CONCURRENCY = 6;

export interface SnapshotRow {
   kind: VideoKind;
   ref_id: string;
   snapshot: string | null;
   attempts: number;
   next_attempt_at: string | null;
   last_error: string | null;
   dead_at: string | null;
   updated_at: string;
}

export function backoffMs(attempts: number): number {
   return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

/** Upsert at pick time (idempotent: picking the same item twice writes one row). */
export async function putSnapshot(db: D1Database, item: ItemDetail, now = new Date()): Promise<Snapshot> {
   const snap = snapshotOf(item, now);
   const at = now.toISOString();
   const next = new Date(now.getTime() + REFRESH_AFTER_MS).toISOString();
   await db
      .prepare(
         `INSERT INTO video_snapshots (kind, ref_id, snapshot, attempts, next_attempt_at, last_error, dead_at, created_at, updated_at)
          VALUES (?1, ?2, ?3, 0, ?4, NULL, NULL, ?5, ?5)
          ON CONFLICT (kind, ref_id) DO UPDATE SET snapshot = excluded.snapshot, attempts = 0, next_attempt_at = excluded.next_attempt_at,
            last_error = NULL, dead_at = NULL, updated_at = excluded.updated_at`,
      )
      .bind(item.kind, item.id, JSON.stringify(snap), next, at)
      .run();
   return snap;
}

export async function getSnapshots(db: D1Database, refs: { kind: string; ref_id: string }[]): Promise<Map<string, Record<string, unknown>>> {
   const out = new Map<string, Record<string, unknown>>();
   if (!refs.length) return out;
   // D1 caps bound parameters at 100 per statement.
   for (let i = 0; i < refs.length; i += 45) {
      const part = refs.slice(i, i + 45);
      const { results } = await db
         .prepare(`SELECT kind, ref_id, snapshot FROM video_snapshots WHERE ${part.map((_, j) => `(kind = ?${j * 2 + 1} AND ref_id = ?${j * 2 + 2})`).join(" OR ")}`)
         .bind(...part.flatMap((r) => [r.kind, r.ref_id]))
         .all<{ kind: string; ref_id: string; snapshot: string | null }>();
      for (const r of results) {
         try {
            const s = r.snapshot ? (JSON.parse(r.snapshot) as Record<string, unknown>) : null;
            if (s) out.set(`${r.kind}:${r.ref_id}`, s);
         } catch {
            /* skip a malformed row */
         }
      }
   }
   return out;
}

export interface QueueResult {
   due: number;
   refreshed: number;
   hidden: number;
   retrying: number;
   dead: number;
   skipped: number;
}

function hidden(previous: string | null, refId: string, now: Date) {
   let prev: Record<string, unknown> = {};
   try {
      prev = previous ? (JSON.parse(previous) as Record<string, unknown>) : {};
   } catch {
      /* keep {} */
   }
   return { ...prev, title: typeof prev.title === "string" ? prev.title : refId, thumbnail_url: null, public: false, refreshed_at: now.toISOString() };
}

/** One run of the refresh queue: due rows that a page still uses, oldest first. */
export async function runSnapshotQueue(
   db: D1Database,
   videosApiUrl: string,
   fetchImpl: typeof fetch = fetch,
   opts: { now?: Date; limit?: number; concurrency?: number; onChange?: (kind: VideoKind, refId: string) => Promise<void> } = {},
): Promise<QueueResult> {
   const now = opts.now ?? new Date();
   const at = now.toISOString();
   const { results } = await db
      .prepare(
         `SELECT vs.kind, vs.ref_id, vs.snapshot, vs.attempts, vs.updated_at FROM video_snapshots vs
          WHERE vs.dead_at IS NULL AND (vs.next_attempt_at IS NULL OR vs.next_attempt_at <= ?1)
            AND (EXISTS (SELECT 1 FROM pages p, json_tree(p.blocks) j
                         WHERE json_valid(p.blocks) AND j.key = 'ref_id' AND j.value = vs.ref_id)
                 -- the home timeline: video entries, and ::video lines in posts on it (src/lib/feed)
                 OR EXISTS (SELECT 1 FROM timeline_entries te WHERE te.kind = 'video' AND te.video_kind = vs.kind AND te.ref_id = vs.ref_id)
                 -- the CMS video library and curated pages (src/lib/library.ts, src/lib/lists.ts)
                 OR EXISTS (SELECT 1 FROM cms_videos cv WHERE cv.kind = vs.kind AND cv.ref_id = vs.ref_id)
                 OR EXISTS (SELECT 1 FROM page_entries pe WHERE pe.kind = 'video' AND pe.video_kind = vs.kind AND pe.ref_id = vs.ref_id)
                 OR (vs.kind = 'video' AND EXISTS (SELECT 1 FROM posts po WHERE po.body LIKE '%::video[' || vs.ref_id || ']%')))
          ORDER BY coalesce(vs.next_attempt_at, ''), vs.ref_id
          LIMIT ?2`,
      )
      .bind(at, opts.limit ?? BATCH)
      .all<SnapshotRow>();
   const out: QueueResult = { due: results.length, refreshed: 0, hidden: 0, retrying: 0, dead: 0, skipped: 0 };
   let next = 0;
   const cas = async (row: SnapshotRow, sql: string, ...binds: unknown[]) => {
      const res = await db
         .prepare(`UPDATE video_snapshots SET ${sql}, updated_at = ?1 WHERE kind = ?2 AND ref_id = ?3 AND updated_at = ?4`)
         .bind(at, row.kind, row.ref_id, row.updated_at, ...binds)
         .run();
      return res.meta.changes > 0;
   };
   const worker = async () => {
      while (next < results.length) {
         const row = results[next++];
         let item: ItemDetail | null;
         try {
            item = await lookupForSnapshot(videosApiUrl, row.kind, row.ref_id, fetchImpl);
         } catch (error) {
            const attempts = row.attempts + 1;
            const code = error instanceof VideosApiError ? error.message.slice(0, 120) : error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network error";
            if (attempts >= MAX_ATTEMPTS) {
               if (await cas(row, "attempts = ?5, last_error = ?6, dead_at = ?1, next_attempt_at = NULL", attempts, code)) out.dead++;
               else out.skipped++;
            } else if (await cas(row, "attempts = ?5, last_error = ?6, next_attempt_at = ?7", attempts, code, new Date(now.getTime() + backoffMs(attempts)).toISOString())) out.retrying++;
            else out.skipped++;
            continue;
         }
         const snap = item ? snapshotOf(item, now) : hidden(row.snapshot, row.ref_id, now);
         const ok = await cas(row, "snapshot = ?5, attempts = 0, last_error = NULL, next_attempt_at = ?6", JSON.stringify(snap), new Date(now.getTime() + REFRESH_AFTER_MS).toISOString());
         if (!ok) out.skipped++;
         else if (item) out.refreshed++;
         else out.hidden++;
         // What www shows changed (title, thumbnail, gone private): tell the home timeline.
         if (ok && opts.onChange && sameSnapshot(row.snapshot, snap as unknown as Record<string, unknown>) === false) await opts.onChange(row.kind, row.ref_id).catch(() => {});
      }
   };
   await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? CONCURRENCY, results.length) }, worker));
   return out;
}

/** Whether a stored snapshot (text) and a new one show the same thing (refreshed_at aside). */
export function sameSnapshot(stored: string | null, next: Record<string, unknown>): boolean {
   try {
      const prev = stored ? (JSON.parse(stored) as Record<string, unknown>) : null;
      if (!prev) return false;
      const strip = ({ refreshed_at: _r, ...rest }: Record<string, unknown>) => JSON.stringify(rest, Object.keys(rest).sort());
      return strip(prev) === strip(next);
   } catch {
      return false;
   }
}

export interface DeadSnapshot {
   kind: VideoKind;
   ref_id: string;
   title: string;
   last_error: string | null;
   dead_at: string;
   attempts: number;
}

/** Dead-lettered rows (for the Overview flag). */
export async function deadSnapshots(db: D1Database, limit = 20): Promise<{ items: DeadSnapshot[]; total: number }> {
   const [rows, count] = await Promise.all([
      db.prepare("SELECT kind, ref_id, snapshot, last_error, dead_at, attempts FROM video_snapshots WHERE dead_at IS NOT NULL ORDER BY dead_at DESC LIMIT ?1").bind(limit).all<SnapshotRow>(),
      db.prepare("SELECT COUNT(*) AS n FROM video_snapshots WHERE dead_at IS NOT NULL").first<{ n: number }>(),
   ]);
   return {
      total: Number(count?.n ?? 0),
      items: rows.results.map((r) => {
         let title = r.ref_id;
         try {
            const s = r.snapshot ? (JSON.parse(r.snapshot) as { title?: unknown }) : null;
            if (typeof s?.title === "string") title = s.title;
         } catch {
            /* keep the id */
         }
         return { kind: r.kind, ref_id: r.ref_id, title, last_error: r.last_error, dead_at: String(r.dead_at), attempts: r.attempts };
      }),
   };
}

/** Puts dead-lettered rows back in the queue (due now). Idempotent. Returns how many were requeued. */
export async function retryDead(db: D1Database, now = new Date()): Promise<number> {
   const at = now.toISOString();
   const res = await db.prepare("UPDATE video_snapshots SET dead_at = NULL, attempts = 0, next_attempt_at = ?1, updated_at = ?1 WHERE dead_at IS NOT NULL").bind(at).run();
   return res.meta.changes;
}
