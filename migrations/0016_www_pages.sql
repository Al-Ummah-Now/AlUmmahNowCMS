-- 0016_www_pages: www pages are content pages, curated lists or filters; the CMS video library
-- (docs/specs/WWW-PAGES.md). Expand-only. Never edit this file after it is merged; add a new migration instead.
--
-- Two data rewrites, both explicitly allowed:
--   curated_videos:   rows the videos site no longer serves (snapshot public = false) move to the trash
--                     first (restorable for 30 days, docs/SOFT_DELETE.md), then leave the table.
--   timeline_entries: post override rows whose post exists neither in posts nor in the trash are
--                     purged (QA had 126, from test posts hard-deleted before soft delete existed).
--                     They are overrides, not admin items; a trashed post keeps its row.
-- migration-guard: allow-data-rewrite curated_videos
-- migration-guard: allow-data-rewrite timeline_entries

-- 1. Page kinds. NULL = content page (blocks); 'curated' = its own list (page_entries);
--    'filter' = everything published of the kinds in list_filter ({"kinds": [...], "tag": null}).
alter table "pages" add column "list_kind" text;
alter table "pages" add column "list_filter" text;

-- 2. The CMS video library: every video, playlist and channel an editor added, once. /videos and every
--    filter page with video kinds list it, newest added first. Written by the Worker only.
create table "cms_videos" (
  "id" integer not null primary key autoincrement,
  "kind" text not null,
  "ref_id" text not null,
  "locale" text not null default 'all',
  "added_at" text not null,
  "added_by" text,
  "added_from" text,
  "created_at" text not null,
  "updated_at" text not null
);
create unique index "idx_cms_videos_ref" on "cms_videos" ("kind", "ref_id");
create index "idx_cms_videos_added" on "cms_videos" ("added_at");

-- 3. A curated page's entries: timeline_entries' shape, one page each (a page has one locale).
--    kind 'post': a post on the list (with its overrides); kind 'video': a video, playlist or channel.
create table "page_entries" (
  "id" integer not null primary key autoincrement,
  "page_id" integer not null,
  "kind" text not null,
  "post_id" integer,
  "video_kind" text,
  "ref_id" text,
  "entry_date" text,
  "title_override" text,
  "hidden" integer not null default 0,
  "pin_rank" integer,
  "created_at" text not null,
  "created_by" text,
  "updated_at" text not null,
  "updated_by" text
);
create unique index "idx_page_entries_post" on "page_entries" ("page_id", "post_id") where "kind" = 'post';
create unique index "idx_page_entries_video" on "page_entries" ("page_id", "video_kind", "ref_id") where "kind" = 'video';
create index "idx_page_entries_page" on "page_entries" ("page_id");

-- 4. Dead curated rows → Recently deleted (one trash row and one trash_events row each).
insert into "trash" ("kind", "item_id", "label", "locale", "data", "deleted_at", "deleted_by", "reason")
  select 'curated_videos', cv."id",
         coalesce(nullif(cv."title_override", ''), json_extract(cv."snapshot", '$.title'), cv."ref_id"),
         cv."locale",
         json_object('id', cv."id", 'kind', cv."kind", 'ref_id', cv."ref_id", 'placement', cv."placement", 'locale', cv."locale",
                     'title_override', cv."title_override", 'sort', cv."sort", 'status', cv."status", 'snapshot', cv."snapshot",
                     'created_at', cv."created_at", 'updated_at', cv."updated_at"),
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system/migration-0016', 'Not public on the videos site (www pages migration)'
  from "curated_videos" cv
  where json_valid(cv."snapshot") and json_extract(cv."snapshot", '$.public') = 0
    and not exists (select 1 from "trash" t where t."kind" = 'curated_videos' and t."item_id" = cv."id");
insert into "trash_events" ("action", "kind", "item_id", "label", "actor_email", "detail", "created_at")
  select 'delete', 'curated_videos', t."item_id", t."label", 'system/migration-0016', json_object('reason', t."reason"), t."deleted_at"
  from "trash" t where t."kind" = 'curated_videos' and t."deleted_by" = 'system/migration-0016';
delete from "curated_videos" where "id" in (select "item_id" from "trash" where "kind" = 'curated_videos');

-- 5. Orphan post overrides (post gone, not in the trash).
delete from "timeline_entries"
  where "kind" = 'post'
    and "post_id" not in (select "id" from "posts")
    and "post_id" not in (select "item_id" from "trash" where "kind" = 'posts');

-- 6. Snapshots for the curated videos that move (the cron refreshes them from here on).
insert or ignore into "video_snapshots" ("kind", "ref_id", "snapshot", "attempts", "created_at", "updated_at")
  select cv."kind", cv."ref_id", cv."snapshot", 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from "curated_videos" cv
  where cv."status" = 'published' and json_valid(cv."snapshot");

-- 7. Home: published curated home videos become timeline entries, dated when they were curated. An
--    existing entry for the same video and language wins; 'all' is skipped where a one-language entry exists.
insert into "timeline_entries" ("kind", "video_kind", "ref_id", "locale", "entry_date", "hidden", "created_at", "created_by", "updated_at", "updated_by")
  select 'video', cv."kind", cv."ref_id", coalesce(cv."locale", 'all'), coalesce(cv."created_at", strftime('%Y-%m-%dT%H:%M:%fZ', 'now')), 0,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system/migration-0016', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system/migration-0016'
  from "curated_videos" cv
  where cv."placement" = 'home' and cv."status" = 'published' and cv."kind" in ('video', 'playlist')
    and not exists (select 1 from "timeline_entries" te where te."kind" = 'video' and te."video_kind" = cv."kind" and te."ref_id" = cv."ref_id"
                    and (te."locale" = coalesce(cv."locale", 'all') or te."locale" = 'all' or coalesce(cv."locale", 'all') = 'all'));
insert into "timeline_changes" ("action", "entry_kind", "entry_ref", "locale", "detail", "actor_email", "created_at")
  select 'add', 'video', 'v' || te."id", te."locale", json_object('kind', te."video_kind", 'ref_id', te."ref_id", 'entry_date', te."entry_date", 'from', 'curated_videos'),
         'system/migration-0016', te."created_at"
  from "timeline_entries" te where te."kind" = 'video' and te."created_by" = 'system/migration-0016';

-- 8. The library: published curated rows and every home video entry, once per (kind, ref_id). Language:
--    'all' unless every source row agrees on one; added_at: the earliest source row.
insert into "cms_videos" ("kind", "ref_id", "locale", "added_at", "added_by", "added_from", "created_at", "updated_at")
  select s."kind", s."ref_id",
         case when count(distinct s."locale") = 1 then max(s."locale") else 'all' end,
         min(s."at"), 'system/migration-0016', 'migration-0016',
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from (
    select cv."kind" as "kind", cv."ref_id" as "ref_id", coalesce(cv."locale", 'all') as "locale", coalesce(cv."created_at", strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) as "at"
      from "curated_videos" cv where cv."status" = 'published' and cv."kind" in ('video', 'playlist', 'channel')
    union all
    select te."video_kind", te."ref_id", coalesce(te."locale", 'all'),
           case when te."created_by" = 'system/migration-0016' then te."entry_date" else te."created_at" end
      from "timeline_entries" te where te."kind" = 'video'
  ) s
  where s."ref_id" is not null
    and not exists (select 1 from "cms_videos" c where c."kind" = s."kind" and c."ref_id" = s."ref_id")
  group by s."kind", s."ref_id";

-- 9. /videos and /articles become filter pages (a slug that already exists is left as it is).
insert or ignore into "pages" ("slug", "locale", "translation_key", "title", "summary", "status", "published_at", "show_in_sitemap", "list_kind", "list_filter", "created_at", "updated_at")
  values
  ('videos', 'en', 'www-videos', 'Videos', 'Lessons, series and channels our editors have added, newest first. The full library lives on Al Ummah Now Videos.',
   'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 'filter', '{"kinds":["video","playlist","channel"],"tag":null}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('videos', 'ar', 'www-videos', 'المرئيات', 'دروس وسلاسل وقنوات أضافها فريق التحرير، الأحدث أولًا. المكتبة الكاملة على مرئيات الأمة الآن.',
   'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 'filter', '{"kinds":["video","playlist","channel"],"tag":null}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('articles', 'en', 'www-articles', 'Articles', 'Announcements and updates from the Al Ummah Now team.',
   'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 'filter', '{"kinds":["article","cards"],"tag":null}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('articles', 'ar', 'www-articles', 'المقالات', 'إعلانات ومستجدات من فريق الأمة الآن.',
   'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, 'filter', '{"kinds":["article","cards"],"tag":null}', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- The home feed is rebuilt by the FEED_FORMAT bump this release carries (src/lib/feed/format.ts): the
-- release step claims the full rebuild and wakes the queue. Nothing is marked dirty here.
