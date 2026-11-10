-- 0006_page_blocks_card_posts: page blocks and card posts (docs/SPEC.md §4.1, §4.2). Expand-only.
-- Never edit this file after it is merged; add a new migration instead.
--
-- 1. pages_backup_0006: a full copy of `pages` as it was before this migration (nothing is removed
--    or changed below, but the copy makes the rewrite provable and reversible by hand).
-- 2. pages.blocks: a new JSON column.
-- 3. Every existing page with a body gets that body as ONE rich-text block, verbatim. `body` itself
--    is not touched (the public API keeps serving it). Rows that already have blocks are skipped,
--    so re-running the statement is a no-op.
-- 4. video_snapshots: what www shows for videos used in page blocks (shelves, embeds), written by
--    the Worker only (the picker at pick time, the cron refresh after), never by bknd's data API.
--    attempts / next_attempt_at / dead_at make the refresh a retrying queue with a dead-letter state.
-- migration-guard: allow-data-rewrite pages
create table "pages_backup_0006" as select * from "pages";
alter table "pages" add column "blocks" text;
update "pages" set "blocks" = json_array(json_object('id', 'body', 'type', 'markdown', 'text', "body"))
  where "blocks" is null and "body" is not null and trim("body", ' ' || char(9) || char(10) || char(13)) <> '';
create table "video_snapshots" (
  "kind" text not null,
  "ref_id" text not null,
  "snapshot" text,
  "attempts" integer not null default 0,
  "next_attempt_at" text,
  "last_error" text,
  "dead_at" text,
  "created_at" text not null,
  "updated_at" text not null,
  primary key ("kind", "ref_id")
);
create index "idx_video_snapshots_dead_at" on "video_snapshots" ("dead_at");
-- 5. Card posts (docs/SPEC.md §4.2): posts.kind ("article" | "cards"; NULL reads as article, so
--    every existing post stays an article) and posts.slides (JSON). No existing data changes.
alter table "posts" add column "kind" text;
alter table "posts" add column "slides" text;
create index "idx_posts_kind_status_locale_published_at" on "posts" ("kind", "status", "locale", "published_at");
