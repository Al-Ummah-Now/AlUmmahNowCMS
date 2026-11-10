-- AI assist runs on Workers AI (docs/AI_ASSIST_SPEC.md §5): log the Neurons each call was billed.
-- Rows written before the move (none in any env) keep 0. Expand-only.
ALTER TABLE ai_usage ADD COLUMN neurons REAL NOT NULL DEFAULT 0;
