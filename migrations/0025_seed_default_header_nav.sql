-- Restore www's fallback links when 0024 populated a previously empty header.
-- Never edit this file after it is merged; add a new migration instead.
-- Back up the lone Scholars row before moving it.
-- migration-guard: allow-data-rewrite nav_items
create table if not exists "nav_items_backup_0025" as select * from "nav_items" where 0;

insert into "nav_items_backup_0025"
  select s.* from "nav_items" s
  where s."menu" = 'header' and s."locale" in ('en', 'ar') and s."sort" = 1
    and rtrim(s."url", '/') in ('/scholars', '/' || s."locale" || '/scholars')
    and not exists (
      select 1 from "nav_items" n
      where n."menu" = 'header' and n."locale" = s."locale" and n."id" <> s."id"
    )
    and s."id" not in (select "id" from "nav_items_backup_0025");

update "nav_items" as s set "sort" = 4
  where s."id" in (select "id" from "nav_items_backup_0025")
    and s."menu" = 'header' and s."sort" = 1
    and rtrim(s."url", '/') in ('/scholars', '/' || s."locale" || '/scholars')
    and not exists (
      select 1 from "nav_items" n
      where n."menu" = 'header' and n."locale" = s."locale" and n."id" <> s."id"
    );

-- Insert all defaults together so each sees the same header state.
insert into "nav_items" ("menu", "locale", "label", "url", "sort", "status", "created_at", "updated_at")
  select 'header', s."locale", s."label", s."url", s."sort", 'published',
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from (
    select 'en' as "locale", 'Articles' as "label", '/articles/' as "url", 1 as "sort"
    union all select 'en', 'Videos', '/videos/', 2
    union all select 'en', 'About', '/about/', 3
    union all select 'ar', 'المقالات', '/articles/', 1
    union all select 'ar', 'المرئيات', '/videos/', 2
    union all select 'ar', 'من نحن', '/about/', 3
  ) s
  where exists (
    select 1 from "nav_items" sc join "nav_items_backup_0025" b on b."id" = sc."id"
    where sc."menu" = 'header' and sc."locale" = s."locale" and sc."sort" = 4
      and rtrim(sc."url", '/') in ('/scholars', '/' || s."locale" || '/scholars')
      and not exists (
        select 1 from "nav_items" n
        where n."menu" = 'header' and n."locale" = s."locale" and n."id" <> sc."id"
      )
  )
  and not exists (
    select 1 from "trash" t
    where t."kind" = 'nav_items' and json_valid(t."data")
      and json_extract(t."data", '$.menu') = 'header' and json_extract(t."data", '$.locale') = s."locale"
      and rtrim(json_extract(t."data", '$.url'), '/') in (rtrim(s."url", '/'), '/' || s."locale" || rtrim(s."url", '/'))
  );
