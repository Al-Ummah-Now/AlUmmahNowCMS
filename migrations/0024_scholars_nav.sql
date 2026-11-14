-- 0024_scholars_nav: a Scholars link in www's header menu (AlUmmahNowUI#41), en "Scholars" and
-- ar "العلماء", url /scholars/ (www prefixes the language). Expand-only: inserts, no rewrites.
-- Never edit this file after it is merged; add a new migration instead.
--
-- Added last in each language's header menu (sort = the highest + 1), so the existing links keep
-- their order; editors move it on the Navigation screen. Only inserted when the header menu of that
-- language has no /scholars/ link yet (an editor already added one) and no such link is in Recently
-- deleted (an editor removed it on purpose).
insert into "nav_items" ("menu", "locale", "label", "url", "sort", "status", "created_at", "updated_at")
  select 'header', s."locale", s."label", '/scholars/',
         coalesce((select max(n."sort") from "nav_items" n where n."menu" = 'header' and n."locale" = s."locale"), 0) + 1,
         'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from (select 'en' as "locale", 'Scholars' as "label" union all select 'ar', 'العلماء') s
  where not exists (
    select 1 from "nav_items" n
    where n."menu" = 'header' and n."locale" = s."locale" and rtrim(n."url", '/') in ('/scholars', '/' || s."locale" || '/scholars')
  )
  and not exists (
    select 1 from "trash" t
    where t."kind" = 'nav_items' and json_valid(t."data")
      and json_extract(t."data", '$.menu') = 'header' and json_extract(t."data", '$.locale') = s."locale"
      and rtrim(json_extract(t."data", '$.url'), '/') in ('/scholars', '/' || s."locale" || '/scholars')
  );
