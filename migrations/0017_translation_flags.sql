-- 0017_translation_flags: editors flag a word or sentence of a translation (docs/TRANSLATION_FLAGS.md).
-- Expand-only. Never edit this file after it is merged; add a new migration instead.
-- Worker-owned tables, outside bknd's schema (bknd's data API never exposes them).
--
-- 1. translation_flags: one flagged span of a page/post translation. The span is anchored by its quote,
--    up to 32 characters before/after it and its offsets (src/lib/translation-flags/anchor.ts), so it
--    survives edits elsewhere in the field. `field` is title | summary | body | slide:<slide id>:heading
--    | slide:<slide id>:body. source_* is the matching part of the other language's version (best effort:
--    sentence, else paragraph, else the whole field). status: open | resolved | dismissed. Resolved and
--    dismissed flags stay as history.
-- 2. translation_flag_events: the audit trail of every flag (created, resolved, dismissed, reopened,
--    added to the glossary): who, when, what.
-- 3. translation_glossary: preferred renderings (source term → target term) that the translation prompt
--    includes (src/lib/ai/runner.ts). Soft delete: deleted_at set, restorable for 30 days, then purged by
--    the 30-minute cron.
CREATE TABLE IF NOT EXISTS translation_flags (
   id TEXT PRIMARY KEY,
   kind TEXT NOT NULL,
   row_id INTEGER NOT NULL,
   locale TEXT NOT NULL,
   field TEXT NOT NULL,
   quote TEXT NOT NULL,
   prefix TEXT NOT NULL DEFAULT '',
   suffix TEXT NOT NULL DEFAULT '',
   start_offset INTEGER NOT NULL,
   end_offset INTEGER NOT NULL,
   source_row_id INTEGER,
   source_text TEXT,
   source_scope TEXT NOT NULL DEFAULT 'none',
   reason TEXT NOT NULL,
   suggestion TEXT,
   note TEXT,
   quran INTEGER NOT NULL DEFAULT 0,
   quran_url TEXT,
   status TEXT NOT NULL DEFAULT 'open',
   resolution TEXT,
   created_by INTEGER,
   created_by_email TEXT,
   created_at INTEGER NOT NULL,
   resolved_by INTEGER,
   resolved_by_email TEXT,
   resolved_at INTEGER,
   updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_translation_flags_row ON translation_flags (kind, row_id, status);

CREATE TABLE IF NOT EXISTS translation_flag_events (
   id TEXT PRIMARY KEY,
   flag_id TEXT NOT NULL,
   at INTEGER NOT NULL,
   user_id INTEGER,
   email TEXT,
   action TEXT NOT NULL,
   detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_translation_flag_events_flag ON translation_flag_events (flag_id, at);

CREATE TABLE IF NOT EXISTS translation_glossary (
   id TEXT PRIMARY KEY,
   source_locale TEXT NOT NULL,
   source_term TEXT NOT NULL,
   target_locale TEXT NOT NULL,
   target_term TEXT NOT NULL,
   note TEXT,
   flag_id TEXT,
   created_by INTEGER,
   created_by_email TEXT,
   created_at INTEGER NOT NULL,
   updated_at INTEGER NOT NULL,
   deleted_at INTEGER,
   deleted_by_email TEXT
);
CREATE INDEX IF NOT EXISTS idx_translation_glossary_pair ON translation_glossary (source_locale, target_locale, deleted_at);
