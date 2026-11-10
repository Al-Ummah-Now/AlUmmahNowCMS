/**
 * Scheduled publishing (issue #7). A page or post is live when `status = 'published'` and its
 * `publish_at` is empty or has passed. Visibility is decided when the row is read (the public API
 * filters with LIVE_SQL), so going live needs no job: www's 60 s cache bounds the delay.
 *
 * Shared by the Worker (public API, content rules, staff screens) and the staff client bundle.
 */

export type PublishState = "draft" | "scheduled" | "published";

/** bknd stores datetimes as `Date#toISOString()`; SQLite's strftime below has the same shape. */
const NOW_SQL = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/** SQL condition for "served on www" (unqualified column names: pages or posts). */
export const LIVE_SQL = `status = 'published' AND (publish_at IS NULL OR publish_at <= ${NOW_SQL})`;

/** Milliseconds since the epoch, or null for empty or unreadable values. */
export function timeOf(v: unknown): number | null {
   if (v === null || v === undefined || v === "") return null;
   const d = v instanceof Date ? v : typeof v === "number" || typeof v === "string" ? new Date(v) : null;
   const t = d ? d.getTime() : Number.NaN;
   return Number.isNaN(t) ? null : t;
}

export function publishState(row: Record<string, unknown> | null | undefined, now = Date.now()): PublishState {
   if (!row || row.status !== "published") return "draft";
   const at = timeOf(row.publish_at);
   return at !== null && at > now ? "scheduled" : "published";
}
