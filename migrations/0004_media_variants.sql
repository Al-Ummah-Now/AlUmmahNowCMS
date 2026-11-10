-- Image variants (docs/PUBLIC_API.md "Image variants"): one row per original media path.
-- Worker-owned (not a bknd entity); originals in R2 are never changed, variants live under _variants/.
CREATE TABLE IF NOT EXISTS media_variants (
   path TEXT PRIMARY KEY NOT NULL,
   status TEXT NOT NULL DEFAULT 'queued',
   width INTEGER,
   height INTEGER,
   widths TEXT,
   done_widths TEXT NOT NULL DEFAULT '[]',
   attempts INTEGER NOT NULL DEFAULT 0,
   error TEXT,
   queued_at TEXT NOT NULL,
   updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_variants_status ON media_variants (status, updated_at);
