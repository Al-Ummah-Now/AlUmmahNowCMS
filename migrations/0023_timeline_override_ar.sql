-- 0023_timeline_override_ar: a home timeline video entry shown in both languages (locale 'all') gets an
-- Arabic "Title on the site" next to the English one (owner rule 2026-11-16: every localizable field has
-- both languages, no fallback; docs/LOCALIZED_FIELDS.md). For 'all' rows title_override is the English
-- title and title_override_ar the Arabic one; rows in one language keep using title_override.
-- Existing rows are read as they are (src/lib/feed/overrides.ts): no data is rewritten.
-- Expand-only. Never edit this file after it is merged.
alter table "timeline_entries" add column "title_override_ar" text;
