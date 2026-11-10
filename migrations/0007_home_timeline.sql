-- 0007_home_timeline: www's home timeline, managed in the CMS, published to Workers KV (docs/FEED.md).
-- Expand-only. Never edit this file after it is merged; add a new migration instead.
--
-- 1. posts.show_on_timeline: "Show on home timeline" in the post editor. NULL reads as true, so every
--    existing post stays on the timeline (nothing on www changes until an editor turns one off).
alter table "posts" add column "show_on_timeline" boolean;
-- 2. timeline_entries: what editors set on the Timeline screen. Written by the Worker only (never
--    through bknd's data API).
--    kind 'post':  overrides for one post (hidden, pinned). A post with no row is simply on the
--                  timeline when it is live and show_on_timeline is not 0.
--    kind 'video': a video or playlist from the videos platform. Its snapshot lives in
--                  video_snapshots (0006), refreshed by the cron. entry_date is what it sorts by.
--    pin_rank: NULL = not pinned; pinned entries come first, by pin_rank ascending.
--    created_by / updated_by: the staff member's email (who), with created_at / updated_at (when).
create table "timeline_entries" (
  "id" integer not null primary key autoincrement,
  "kind" text not null,
  "post_id" integer,
  "video_kind" text,
  "ref_id" text,
  "locale" text,
  "entry_date" text,
  "title_override" text,
  "hidden" integer not null default 0,
  "pin_rank" integer,
  "created_at" text not null,
  "created_by" text,
  "updated_at" text not null,
  "updated_by" text
);
create unique index "idx_timeline_entries_post" on "timeline_entries" ("post_id") where "kind" = 'post';
create unique index "idx_timeline_entries_video" on "timeline_entries" ("video_kind", "ref_id", "locale") where "kind" = 'video';
create index "idx_timeline_entries_pin" on "timeline_entries" ("pin_rank") where "pin_rank" is not null;
-- 3. timeline_changes: every change made on the Timeline screen (who, when, what, before → after).
create table "timeline_changes" (
  "id" integer not null primary key autoincrement,
  "action" text not null,
  "entry_kind" text not null,
  "entry_ref" text not null,
  "locale" text,
  "detail" text,
  "actor_id" integer,
  "actor_email" text,
  "created_at" text not null
);
create index "idx_timeline_changes_created" on "timeline_changes" ("created_at");
-- 4. The KV feed's bookkeeping (src/lib/feed/jobs.ts). The Worker is the only writer.
--    feed_dirty:   items/weeks a change touched, waiting for the (coalesced) rebuild job.
--    feed_items:   where each published item lives in KV now ('pinned' or an ISO week), so a change
--                  knows the week it leaves.
--    feed_weeks:   the live KV key (and build) of each week bucket, the older week it points to
--                  ("<week>.<build>"), its size, newest/oldest cursor and checksums.
--    feed_years:   the live KV key of each year's week index.
--    feed_heads:   the live head (pointer + first page) per locale.
--    feed_garbage: superseded keys (week tombstones, old year indexes) and when to delete them.
--    feed_state:   one row: queue dedupe, failures (DLQ flag), the publish_at watermark.
create table "feed_dirty" (
  "id" integer not null primary key autoincrement,
  "item" text not null,
  "created_at" text not null
);
create table "feed_items" (
  "locale" text not null,
  "item" text not null,
  "week" text not null,
  primary key ("locale", "item")
);
create index "idx_feed_items_week" on "feed_items" ("locale", "week");
create table "feed_weeks" (
  "locale" text not null,
  "week" text not null,
  "key" text not null,
  "build" text not null,
  "older" text,
  "count" integer not null,
  "newest" text not null,
  "oldest" text not null,
  "sig" text not null,
  "lite" text not null,
  "updated_at" text not null,
  primary key ("locale", "week")
);
create table "feed_years" (
  "locale" text not null,
  "year" integer not null,
  "key" text not null,
  "count" integer not null,
  "sig" text not null,
  "updated_at" text not null,
  primary key ("locale", "year")
);
create table "feed_heads" (
  "locale" text not null primary key,
  "build" text not null,
  "sig" text not null,
  "lite" text not null,
  "built_at" text not null
);
create table "feed_garbage" (
  "key" text not null primary key,
  "delete_after" text not null
);
create index "idx_feed_garbage_delete_after" on "feed_garbage" ("delete_after");
create table "feed_state" (
  "id" integer not null primary key,
  "queued_at" text,
  "last_build" text,
  "last_build_at" text,
  "last_head_write_at" text,
  "attempts" integer not null default 0,
  "last_error" text,
  "failed_at" text,
  "dead_at" text,
  "due_checked_until" text,
  "full_requested_at" text,
  "full_total" integer,
  "updated_at" text
);
insert into "feed_state" ("id", "attempts", "updated_at") values (1, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
