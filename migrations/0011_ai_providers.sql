-- 0011_ai_providers: pluggable AI assist providers (docs/AI_ASSIST_SPEC.md §2.2, §5, §6).
-- Expand-only. Never edit this file after it is merged; add a new migration instead.
--
-- 1. ai_usage.provider: which configured provider answered (rows before this were all Workers AI).
-- 2. ai_settings: the one row of admin-managed settings for this environment (providers, the
--    provider and model per feature, fallback, monthly budget) as JSON. Never holds a key: providers
--    name a Worker secret / Secrets Store binding (AI_KEY_*) that is read at call time.
--    version: bumped on every save (a stale form is refused).
-- 3. ai_settings_audit: every settings change (who, when, which paths changed, before/after JSON)
--    and every "Test connection" run (who, which provider, the outcome).
ALTER TABLE ai_usage ADD COLUMN provider TEXT NOT NULL DEFAULT 'workers-ai';
CREATE INDEX IF NOT EXISTS idx_ai_usage_env_day ON ai_usage (env, day);

CREATE TABLE IF NOT EXISTS ai_settings (
   id INTEGER PRIMARY KEY CHECK (id = 1),
   data TEXT NOT NULL,
   version INTEGER NOT NULL,
   updated_at INTEGER NOT NULL,
   updated_by TEXT
);

CREATE TABLE IF NOT EXISTS ai_settings_audit (
   id TEXT PRIMARY KEY,
   at INTEGER NOT NULL,
   user_id INTEGER,
   email TEXT,
   action TEXT NOT NULL,
   version INTEGER,
   changed TEXT NOT NULL,
   before TEXT,
   after TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_settings_audit_at ON ai_settings_audit (at);
