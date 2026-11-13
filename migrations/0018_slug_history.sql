-- 0018_slug_history: www answers 301 from a renamed post's or page's old address to its current one
-- (owner decision D-SEO-7, wiki AUN-SEO). Expand-only. Never edit this file after it is merged.
-- Worker-owned table, outside bknd's schema (bknd's data API never exposes it).
--
-- slug_history: one row per old address of a published post or page. It points at the row's id, so a
-- second rename still leads to the current slug, and a deleted row leads nowhere (www answers 404/410).
-- A row whose target has that very slug again (renamed back) leads nowhere either: the lookup checks it.
-- Filled by triggers, so every write path (data API, editor, ops scripts) records it. Only renames of
-- published rows are kept: a draft's earlier slug was never public.
create table if not exists slug_history (
  kind text not null check (kind in ('post', 'page')),
  locale text not null,
  old_slug text not null,
  target_id integer not null,
  renamed_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  primary key (kind, locale, old_slug)
);
create index if not exists idx_slug_history_target on slug_history (kind, target_id);

create trigger if not exists trg_posts_slug_history
after update of slug on posts
when old.slug is not null and new.slug is not null and old.slug <> new.slug and old.status = 'published'
begin
  insert into slug_history (kind, locale, old_slug, target_id) values ('post', old.locale, old.slug, old.id)
    on conflict (kind, locale, old_slug) do update set target_id = excluded.target_id, renamed_at = excluded.renamed_at;
end;

create trigger if not exists trg_pages_slug_history
after update of slug on pages
when old.slug is not null and new.slug is not null and old.slug <> new.slug and old.status = 'published'
begin
  insert into slug_history (kind, locale, old_slug, target_id) values ('page', old.locale, old.slug, old.id)
    on conflict (kind, locale, old_slug) do update set target_id = excluded.target_id, renamed_at = excluded.renamed_at;
end;
