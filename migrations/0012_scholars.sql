-- 0012_scholars: scholars write articles that publish to their own page on www and their channel's
-- Community tab; editors feature selected items on the main site (docs/SCHOLARS.md).
-- Expand-only. Never edit this file after it is merged; add a new migration instead.
-- (0011 is taken by the AI providers work.)
--
-- 1. posts: who owns a scholar's post, whether editors featured it, and its community post.
--    author_sub          the scholar's auth user id. NULL = a staff post (on the main site as before).
--    featured_at/_by     set when an editor features a scholar post on the main site (home timeline
--                        and the Articles list). A scholar post with no featured_at is only on the
--                        scholar's page, in search and in their channel community.
--    community_post_id   the community post this article was posted as on the scholar's channel
--                        (api-videos). The sync itself is tracked in community_links (3).
alter table "posts" add column "author_sub" text;
alter table "posts" add column "featured_at" datetime;
alter table "posts" add column "featured_by" text;
alter table "posts" add column "community_post_id" text;
create index "idx_posts_author_sub_status_locale_published_at" on "posts" ("author_sub", "status", "locale", "published_at");
-- 2. scholars: a scholar's public profile (Worker-only, never on bknd's data API). One per auth user,
--    created on their first CMS sign-in as a writer (or by an admin), editable by them and by admins.
--    channel_ids: JSON array of their own channels on the videos platform (from its ownership index);
--    the first is where articles are posted to the Community tab.
--    Deleting a profile is a soft delete like any other (src/lib/trash.ts kind 'scholars'): the row
--    moves to the trash, restorable for 30 days.
create table "scholars" (
  "id" integer not null primary key autoincrement,
  "sso_sub" text not null,
  "slug" text not null,
  "name_en" text,
  "name_ar" text,
  "bio_en" text,
  "bio_ar" text,
  "avatar_media_id" integer,
  "channel_ids" text not null default '[]',
  "created_at" text not null,
  "updated_at" text not null,
  "updated_by" text
);
create unique index "idx_scholars_sso_sub" on "scholars" ("sso_sub");
create unique index "idx_scholars_slug" on "scholars" ("slug");
-- 3. community_links: the article ↔ community post sync (src/lib/scholars/community.ts). Keyed by the
--    post id and kept when the post is deleted (moved to the trash), so the community post can still
--    be hidden. want: 'show' (published: create or update it) or 'hide' (draft, scheduled, deleted).
--    state: 'pending' (to do, also after a failure: next_attempt_at backs off), 'ok', 'dead' (gave up
--    after too many failures; flagged to staff, retried when the post changes again).
create table "community_links" (
  "post_id" integer not null primary key,
  "author_sub" text not null,
  "channel_id" text,
  "community_post_id" text,
  "want" text not null,
  "state" text not null,
  "attempts" integer not null default 0,
  "next_attempt_at" text,
  "last_error" text,
  "updated_at" text not null
);
create index "idx_community_links_due" on "community_links" ("state", "next_attempt_at");
