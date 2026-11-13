-- 0020_ref_channel_index: the nightly scholar reference check (issue #1217, src/lib/scholars/reconcile.ts)
-- reads one channel's references at a time: `WHERE ref_channel_id = ?`. Without this index that is a
-- scan of posts. Expand-only. Never edit this file after it is merged.
create index "idx_posts_ref_channel_id" on "posts" ("ref_channel_id");
