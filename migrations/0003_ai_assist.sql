-- AI writing assist (docs/AI_ASSIST_SPEC.md §6). Worker-owned tables, outside bknd's schema, so
-- bknd's data API never exposes them. Expand-only.
CREATE TABLE IF NOT EXISTS ai_jobs (
   id TEXT PRIMARY KEY,
   dedupe_key TEXT NOT NULL,
   user_id INTEGER NOT NULL,
   feature TEXT NOT NULL,
   kind TEXT NOT NULL,
   row_id INTEGER,
   locale TEXT NOT NULL,
   target_locale TEXT,
   input TEXT NOT NULL,
   status TEXT NOT NULL,
   attempts INTEGER NOT NULL DEFAULT 0,
   lease_until INTEGER NOT NULL DEFAULT 0,
   partial TEXT,
   result TEXT,
   error TEXT,
   flagged INTEGER NOT NULL DEFAULT 0,
   weight INTEGER NOT NULL DEFAULT 1,
   created_at INTEGER NOT NULL,
   updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_dedupe ON ai_jobs (dedupe_key, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_user ON ai_jobs (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_flagged ON ai_jobs (flagged, status);

CREATE TABLE IF NOT EXISTS ai_usage (
   id TEXT PRIMARY KEY,
   at INTEGER NOT NULL,
   day TEXT NOT NULL,
   env TEXT NOT NULL,
   user_id INTEGER,
   feature TEXT NOT NULL,
   model TEXT NOT NULL,
   job_id TEXT,
   input_tokens INTEGER NOT NULL,
   output_tokens INTEGER NOT NULL,
   cache_read_tokens INTEGER NOT NULL DEFAULT 0,
   cache_write_tokens INTEGER NOT NULL DEFAULT 0,
   cost_usd REAL NOT NULL,
   status TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_day ON ai_usage (day);
