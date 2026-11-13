/**
 * Curated snapshots (audit UI-1): every curated row carries what www renders for it, so a www
 * render needs no per-item videos API call. The picker writes a snapshot at pick time; this job
 * refreshes snapshots out of band (cron), because they go stale: titles change, items go
 * private. Signed (expiring) thumbnail URLs from the videos API are swapped for the videos web app's
 * stable `/thumb/<id>.jpg` before they are stored (src/lib/stable-thumb.ts).
 *
 * Safe under concurrency: overlapping runs and editor/picker writes race only through a
 * compare-and-set on the snapshot text (`WHERE snapshot IS <what we read>`), so a refresh never
 * overwrites a newer write; a lost race is retried on the next run.
 */
import { stableSnapshot } from "./stable-thumb.ts";
import { lookupItem, VideosApiError, type ItemDetail, type VideoKind } from "./videos.ts";

export interface Snapshot extends Omit<ItemDetail, "kind" | "id"> {
   /** false: the videos API no longer returns the item as public; the public API hides the row. */
   public: boolean;
   /** ISO time of the lookup this snapshot came from. */
   refreshed_at: string;
}

/** Rows per run (a run every 30 minutes refreshes 200 rows an hour). */
export const REFRESH_BATCH = 100;
export const REFRESH_CONCURRENCY = 6;

/** An item as stored: its signed thumbnails swapped for stable ones (`videosWebUrl`/thumb/<id>.jpg). */
export function snapshotOf(item: ItemDetail, now: Date, videosWebUrl: string): Snapshot {
   const { kind, id, ...rest } = item;
   return stableSnapshot(videosWebUrl, { ...rest, public: true, refreshed_at: now.toISOString() }, kind, id);
}

type Row = { id: number; kind: VideoKind; ref_id: string; snapshot: string | null };

function hiddenSnapshot(previous: string | null, refId: string, now: Date): Record<string, unknown> {
   let prev: Record<string, unknown> = {};
   try {
      prev = previous ? (JSON.parse(previous) as Record<string, unknown>) : {};
   } catch {
      /* keep {} */
   }
   // Keep the editor-facing title; drop the thumbnail (/thumb answers 404 for a non-public video).
   return { ...prev, title: typeof prev.title === "string" ? prev.title : refId, thumbnail_url: null, public: false, refreshed_at: now.toISOString() };
}

export interface RefreshResult {
   checked: number;
   refreshed: number;
   hidden: number;
   failed: number;
   /** Lost a compare-and-set to a newer write (picked up next run). */
   skipped: number;
}

export async function refreshCuratedSnapshots(
   db: D1Database,
   videos: { apiUrl: string; webUrl: string },
   fetchImpl: typeof fetch = fetch,
   opts: { now?: Date; limit?: number; concurrency?: number } = {},
): Promise<RefreshResult> {
   const now = opts.now ?? new Date();
   // Oldest (or never) refreshed first. json_valid guards rows with a malformed snapshot.
   const { results } = await db
      .prepare(
         `SELECT id, kind, ref_id, snapshot FROM curated_videos
          ORDER BY coalesce(CASE WHEN json_valid(snapshot) THEN json_extract(snapshot, '$.refreshed_at') END, ''), id
          LIMIT ?1`,
      )
      .bind(opts.limit ?? REFRESH_BATCH)
      .all<Row>();
   const out: RefreshResult = { checked: results.length, refreshed: 0, hidden: 0, failed: 0, skipped: 0 };
   let next = 0;
   const worker = async () => {
      while (next < results.length) {
         const row = results[next++];
         let item: ItemDetail | null;
         try {
            item = await lookupItem(videos.apiUrl, row.kind, row.ref_id, fetchImpl);
         } catch (error) {
            out.failed++;
            if (!(error instanceof VideosApiError)) console.warn("snapshot refresh failed", row.id, String(error));
            continue;
         }
         const snapshot = item ? snapshotOf(item, now, videos.webUrl) : hiddenSnapshot(row.snapshot, row.ref_id, now);
         const res = await db
            .prepare("UPDATE curated_videos SET snapshot = ?1 WHERE id = ?2 AND snapshot IS ?3")
            .bind(JSON.stringify(snapshot), row.id, row.snapshot)
            .run();
         if (res.meta.changes === 0) out.skipped++;
         else if (item) out.refreshed++;
         else out.hidden++;
      }
   };
   await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? REFRESH_CONCURRENCY, results.length) }, worker));
   return out;
}
