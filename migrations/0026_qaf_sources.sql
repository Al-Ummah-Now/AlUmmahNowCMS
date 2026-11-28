-- Worker-owned tables. Qaf credentials and search data are outside the bknd API.
CREATE TABLE qaf_settings (
   id INTEGER PRIMARY KEY CHECK (id = 1),
   generation TEXT NOT NULL,
   sealed_key TEXT,
   error TEXT,
   request_id TEXT,
   retry_at INTEGER,
   weekly_reset_at INTEGER
);

CREATE TABLE qaf_search_cache (
   key TEXT PRIMARY KEY,
   generation TEXT NOT NULL,
   request_id TEXT,
   data TEXT NOT NULL,
   expires_at INTEGER NOT NULL
);
CREATE INDEX idx_qaf_search_expiry ON qaf_search_cache (expires_at);

CREATE TABLE qaf_search_usage (
   id TEXT PRIMARY KEY,
   generation TEXT NOT NULL,
   at INTEGER NOT NULL
);
CREATE INDEX idx_qaf_usage_generation_at ON qaf_search_usage (generation, at);
CREATE INDEX idx_qaf_usage_at ON qaf_search_usage (at);
