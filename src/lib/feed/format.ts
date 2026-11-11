/**
 * The home timeline's FORMAT version (docs/FEED.md "Format version"): what shape the stored items
 * have and what went into them. Every published head carries `format`, and D1 feed_state.format
 * records the format of the last COMPLETE rebuild. When the deployed code's FEED_FORMAT differs, the
 * feed is rebuilt automatically (src/lib/feed/auto-rebuild.ts): by the release pipeline right after
 * a promote or QA deploy, and lazily by the Worker itself (cron, public /timeline read).
 *
 * Bump FEED_FORMAT whenever a feed item's shape changes (PostSummary fields, video snapshot fields,
 * head/week/year docs) OR what produces their content changes (e.g. how slides or covers are
 * chosen), and append the new shape fingerprint to FEED_FORMAT_HISTORY. A test
 * (test/node/feed-format.test.ts) recomputes the fingerprint from the TypeScript types of
 * FeedShapeRoots and fails when it does not match the entry for FEED_FORMAT; CI
 * (scripts/check-feed-format.ts) fails when a past entry was edited instead of a new one appended.
 *
 * Not the same thing as model.ts FEED_VERSION, which is the KV LAYOUT version www's reader checks
 * (bumping that one breaks www until it ships the same reader).
 */
import type { FeedItem, HeadDoc, WeekDoc, WeekTombstone, YearDoc } from "./model.ts";
import type { postSummaries, snapshotOf } from "../../routes/public-api.ts";

export const FEED_FORMAT = 2;

/**
 * Format → fingerprint of the FeedShapeRoots type it was released with. APPEND-ONLY: never edit or
 * remove an entry; bump FEED_FORMAT and add one.
 *   1: PostSummary with `slides` (CMS #58), first stamped format.
 *   2: channel items on the timeline; channel snapshots carry `latest` (docs/specs/WWW-PAGES.md D7).
 */
export const FEED_FORMAT_HISTORY: Readonly<Record<number, string>> = {
   1: "afcfa9ffd2ba7bdb",
   2: "e41e47060af0efcb",
};

/** Everything whose shape is part of the stored feed (the test fingerprints this type). */
export interface FeedShapeRoots {
   item: FeedItem;
   summary: Awaited<ReturnType<typeof postSummaries>>[number];
   snapshot: NonNullable<ReturnType<typeof snapshotOf>>;
   head: HeadDoc;
   week: WeekDoc;
   tombstone: WeekTombstone;
   year: YearDoc;
}

/** The stored format of a head doc; a head written before formats existed counts as 0. */
export const headFormat = (head: unknown): number => {
   const f = head && typeof head === "object" ? (head as { format?: unknown }).format : undefined;
   return typeof f === "number" && Number.isInteger(f) ? f : 0;
};
