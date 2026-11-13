/**
 * The summary a scholar post reference caches (posts.summary_json, docs/SCHOLARS.md §7). Kept apart
 * from refs.ts so readers (search, the public API) do not import the feed jobs.
 */
import { isPostKind, type PostSummaryV2 } from "../post-schema.generated.ts";

type Row = Record<string, unknown>;

/** The summary cached on a ref row, or null (not a ref, or unreadable). */
export function refSummary(row: Row): PostSummaryV2 | null {
   if (typeof row.ref_post_id !== "string" || !row.ref_post_id) return null;
   try {
      const s = typeof row.summary_json === "string" ? (JSON.parse(row.summary_json) as unknown) : row.summary_json;
      return s && typeof s === "object" && isPostKind((s as { kind?: unknown }).kind) ? (s as PostSummaryV2) : null;
   } catch {
      return null;
   }
}
