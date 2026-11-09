-- 0002_curated_videos_unique: one curated row per (kind, ref_id, placement, locale) (audit CMS-4).
-- Expand-only. Never edit this file after it is merged; add a new migration instead.
--
-- Before the unique index can exist, existing duplicates (a double-click on the picker's "Add")
-- must go. Nothing is lost: every removed row is first copied to curated_videos_dupes_0002.
-- Per group the kept row is the published one if any, else the oldest (lowest id).
-- A NULL locale means "all" everywhere (public API, picker), so it is grouped and stored as 'all';
-- NULLs would otherwise slip past a unique index (SQLite treats NULLs as distinct).
-- migration-guard: allow-data-rewrite curated_videos
create table "curated_videos_dupes_0002" as
  select * from (
    select cv.*, row_number() over (
      partition by cv."kind", cv."ref_id", cv."placement", coalesce(cv."locale", 'all')
      order by (cv."status" = 'published') desc, cv."id"
    ) as "dupe_rank"
    from "curated_videos" cv
  ) where "dupe_rank" > 1;
delete from "curated_videos" where "id" in (select "id" from "curated_videos_dupes_0002");
update "curated_videos" set "locale" = 'all' where "locale" is null;
create unique index "idx_unique_curated_videos_kind_ref_id_placement_locale" on "curated_videos" ("kind", "ref_id", "placement", "locale");
