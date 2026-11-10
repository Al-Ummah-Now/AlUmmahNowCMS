-- 0003_scheduled_publishing: pages and posts can be scheduled (issue #7).
-- Expand-only. Never edit this file after it is merged; add a new migration instead.
--
-- publish_at: when a published row goes live. NULL = live as soon as it is published (every
-- existing row, so nothing on www changes). The public API serves a row only when
-- status = 'published' AND (publish_at IS NULL OR publish_at <= now); see src/lib/schedule.ts.
alter table "pages" add column "publish_at" datetime;
alter table "posts" add column "publish_at" datetime;
