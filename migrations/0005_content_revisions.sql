-- 0005_content_revisions: every create, update and restore of a page or post keeps a revision (issue #8).
-- Expand-only. Never edit this file after it is merged; add a new migration instead.
--
-- Not a bknd entity on purpose: history is written by the Worker only (src/lib/revisions.ts) and
-- read through the staff screens, never through bknd's data API, so nobody can edit or delete it there.
-- snapshot = the full row as saved (JSON). changed = the fields that differ from the previous revision.
-- Storage: every revision is kept; the screens page through them (20 per page).
create table "content_revisions" (
  "id" integer not null primary key autoincrement,
  "entity" text not null,
  "entity_id" integer not null,
  "version" integer not null,
  "action" text not null,
  "actor_id" integer,
  "actor_email" text,
  "restored_from" integer,
  "changed" text,
  "snapshot" text not null,
  "created_at" text not null
);
create unique index "idx_unique_content_revisions_entity_version" on "content_revisions" ("entity", "entity_id", "version");
