-- 0021_about_page: the www About page (/en/about/, /ar/about/) becomes a normal CMS page, so editors
-- change it in the pages editor instead of in www's code. Expand-only: two inserts, no rewrites.
-- Never edit this file after it is merged; add a new migration instead.
--
-- The copy is the owner's, verbatim: www's built-in About page (AlUmmahNowUI
-- apps/www/src/content/fallback/{en,ar}.ts, "copy(www): About …" commits). The body is stored the way
-- migration 0006 stores a page saved before blocks existed: `body` plus ONE markdown block with the same
-- text, which is exactly what the editor writes back on save (content-rules: body = blocksToMarkdown).
--
-- Only inserted when missing: an `about` page that already exists in a language (an editor made one)
-- is left as it is (unique slug+locale → insert or ignore), and an About page an editor deleted (it is in
-- Recently deleted) is not brought back.
insert or ignore into "pages" ("slug", "locale", "translation_key", "title", "summary", "body", "blocks", "status", "published_at", "show_in_sitemap", "created_at", "updated_at")
  select s."slug", s."locale", 'www-about', s."title", s."summary", s."body",
         json_array(json_object('id', 'body', 'type', 'markdown', 'text', s."body")),
         'published', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from (
    select 'about' as "slug", 'en' as "locale", 'About Al Ummah Now' as "title",
           'An Islamic video and community platform, in Arabic and English.' as "summary",
           'Al Ummah Now is a platform where you can share videos, Shorts and community posts.

## What you''ll find here

- Watch and share **videos and Shorts**.
- Read **community posts** from the channels you subscribe to.
- Share **news** that matters to the Ummah.
- Share **educational materials**.
- Watch **live streams** as they happen.

## Get started

Explore videos, or create an account to subscribe to channels and save what you want to come back to.' as "body"
    union all
    select 'about', 'ar', 'عن الأمة الآن',
           'منصة إسلامية للمرئيات والمجتمع، بالعربية والإنجليزية.',
           'الأمة الآن منصة تشارك فيها المرئيات والمقاطع القصيرة ومنشورات المجتمع.

## ماذا تجد هنا؟

- شاهد **المرئيات والمقاطع القصيرة** وشاركها.
- اقرأ **منشورات المجتمع** من القنوات التي تشترك فيها.
- شارك **الأخبار** التي تهمّ الأمة.
- شارك **المواد التعليمية**.
- شاهد **البث المباشر** لحظة بلحظة.

## ابدأ الآن

استكشف المرئيات، أو أنشئ حسابًا لتشترك في القنوات وتحفظ ما تريد الرجوع إليه.'
  ) s
  where not exists (
    select 1 from "trash" t
    where t."kind" = 'pages' and json_valid(t."data")
      and json_extract(t."data", '$.slug') = s."slug" and json_extract(t."data", '$.locale') = s."locale"
  );
