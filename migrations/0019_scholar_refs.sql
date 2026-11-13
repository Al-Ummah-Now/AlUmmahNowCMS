-- 0019_scholar_refs: scholar posts come from community posts (wiki AUN-SCHOLAR-SITES §6.3, SS6). The
-- CMS keeps a hidden REFERENCE row in posts per public post on a scholar's primary channel; www reads
-- the community post itself. Expand-only. Never edit this file after it is merged.
--
-- 1. scholars.primary_channel_id: the channel whose community posts ARE the scholar's posts. Filled from
--    channel_ids[0] (the channel articles were mirrored to) by the Worker (src/lib/scholars/refs.ts
--    fillPrimaryChannels, cron), never by this migration (migrations do not rewrite data).
alter table "scholars" add column "primary_channel_id" text;
create index "idx_scholars_primary_channel_id" on "scholars" ("primary_channel_id");
-- 2. posts: reference columns (Worker-only, hidden from bknd's data API like author_sub).
--    ref_post_id     the community post (api-videos) this row stands for; one row per post.
--    ref_channel_id  its channel (the scholar's primary channel when it was referenced).
--    summary_json    PostV2 summary (post-schema postSummary): lists, the home timeline and search
--                    render from it without reading the post. Refreshed on every sync, never edited.
--    A reference keeps posts.kind = its community post's kind (article, cards, text, image, poll, quiz,
--    video, gif, link), so the Articles list and /cards keep working on kind.
alter table "posts" add column "ref_post_id" text;
alter table "posts" add column "ref_channel_id" text;
alter table "posts" add column "summary_json" text;
create unique index "idx_unique_posts_ref_post_id" on "posts" ("ref_post_id");
