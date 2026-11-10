-- 0014_feed_format: the home timeline's stored format is stamped, so a release that changes the
-- feed's item shape rebuilds it on its own (docs/FEED.md "Format version"). Expand-only. Never edit
-- this file after it is merged; add a new migration instead. Not part of src/schema.ts (bknd does
-- not manage these tables).
--
-- feed_state.format: the FEED_FORMAT (src/lib/feed/format.ts) that every published week and head
--   was last fully rebuilt with; NULL = never (a feed written before this migration).
alter table "feed_state" add column "format" integer;
-- system_tokens: short-lived one-time-ish credentials for server-side calls from the release
-- pipeline (scripts/release/feed-format.ts). The pipeline writes the SHA-256 of a random token
-- with its Cloudflare credentials (wrangler d1 execute), calls the Worker with the token, then
-- deletes the row. Only the hash is stored.
--   token_hash:  hex SHA-256 of the token
--   purpose:     what the token may do ('feed-format')
--   expires_at:  ISO time after which the Worker refuses it
create table "system_tokens" (
  "token_hash" text not null primary key,
  "purpose" text not null,
  "expires_at" text not null,
  "created_at" text not null
);
