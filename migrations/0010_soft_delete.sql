-- 0010_soft_delete: admin deletes are soft deletes (docs/SOFT_DELETE.md).
-- Expand-only. Never edit this file after it is merged; add a new migration instead.
--
-- 1. trash: an item an admin deleted. The row leaves its own table (so every reader, public API,
--    sitemap, home timeline, staff lists, stops seeing it with no filter to forget) and its full
--    row is kept here as JSON. Nothing outside D1 is removed: R2 objects, image variants and
--    content history stay until the purge.
--    kind:     the table it came from (pages, posts, nav_items, curated_videos, site_settings,
--              media, timeline_entries).
--    item_id:  its id there (restore puts it back under the same id; AUTOINCREMENT never reuses one).
--    ref:      media: the R2 path. timeline_entries: the feed key (v<id>).
--    label:    what the Recently deleted screen shows (title, label, file name).
--    deleted_at / deleted_by / deleted_by_id / reason: who deleted it, when and why.
--    purge_requested_at / purge_requested_by: an admin's "Delete permanently now". The cleanup
--              purges it on its next run; until then it can still be restored.
--    purging_at: the cleanup claimed it (restore is refused while set and recent).
--    purge_attempts / purge_error: the cleanup failed this many times, and why (retried next run).
--    parent_id: deleted together with that trash row (a page's or post's cover): hidden from the
--              Recently deleted list, restored and purged with its parent.
--    The cleanup (src/lib/trash.ts purgeDue) is the only code that hard-deletes.
create table "trash" (
  "id" integer not null primary key autoincrement,
  "kind" text not null,
  "item_id" integer not null,
  "ref" text,
  "label" text,
  "locale" text,
  "data" text not null,
  "deleted_at" text not null,
  "deleted_by" text,
  "deleted_by_id" integer,
  "reason" text,
  "purge_requested_at" text,
  "purge_requested_by" text,
  "purging_at" text,
  "purge_attempts" integer not null default 0,
  "purge_error" text,
  "parent_id" integer
);
create unique index "idx_trash_kind_item" on "trash" ("kind", "item_id");
create index "idx_trash_deleted_at" on "trash" ("deleted_at");
create index "idx_trash_purge_requested" on "trash" ("purge_requested_at") where "purge_requested_at" is not null;
create index "idx_trash_media_ref" on "trash" ("ref") where "kind" = 'media';
create index "idx_trash_parent" on "trash" ("parent_id") where "parent_id" is not null;
-- 2. trash_events: the audit log (delete, restore, purge_requested, purged, purge_failed), with who
--    and when. Kept after the purge so a permanent deletion stays accountable.
create table "trash_events" (
  "id" integer not null primary key autoincrement,
  "action" text not null,
  "kind" text not null,
  "item_id" integer not null,
  "label" text,
  "actor_id" integer,
  "actor_email" text,
  "detail" text,
  "created_at" text not null
);
create index "idx_trash_events_created" on "trash_events" ("created_at");
