-- 0022_about_blocks: the seeded About page (0021) laid out with the page builder's blocks (wiki
-- AUN-CMS-PAGE-BUILDER §7): a hero (the page title, the owner's first line), "What you'll find here" as
-- a feature list with icons, and "Get started" in a soft panel. The words are the owner's, verbatim
-- (the list's bold is dropped: feature labels are plain text).
-- Never edit this file after it is merged; add a new migration instead.
--
-- Only a page that is still exactly as 0021 seeded it changes: translation_key 'www-about', ONE markdown
-- block with id 'body' whose text is the body, and that body is 0021's text. A page an editor changed
-- is left alone. Every row changed is copied to pages_backup_0022 first, so the change can be undone
-- by hand. Blocks without a style (v1) need no rewrite: every reader normalizes them (page-blocks.ts).
-- migration-guard: allow-data-rewrite pages
create table if not exists "pages_backup_0022" as select * from "pages" where 0;

insert into "pages_backup_0022"
  select * from "pages"
  where "translation_key" = 'www-about' and "slug" = 'about' and "locale" in ('en', 'ar')
    and json_valid("blocks") and json_array_length("blocks") = 1
    and json_extract("blocks", '$[0].id') = 'body' and json_extract("blocks", '$[0].type') = 'markdown'
    and json_extract("blocks", '$[0].text') = "body"
    and "body" = case "locale" when 'en' then 'Al Ummah Now is a platform where you can share videos, Shorts and community posts.

## What you''ll find here

- Watch and share **videos and Shorts**.
- Read **community posts** from the channels you subscribe to.
- Share **news** that matters to the Ummah.
- Share **educational materials**.
- Watch **live streams** as they happen.

## Get started

Explore videos, or create an account to subscribe to channels and save what you want to come back to.' when 'ar' then 'الأمة الآن منصة تشارك فيها المرئيات والمقاطع القصيرة ومنشورات المجتمع.

## ماذا تجد هنا؟

- شاهد **المرئيات والمقاطع القصيرة** وشاركها.
- اقرأ **منشورات المجتمع** من القنوات التي تشترك فيها.
- شارك **الأخبار** التي تهمّ الأمة.
- شارك **المواد التعليمية**.
- شاهد **البث المباشر** لحظة بلحظة.

## ابدأ الآن

استكشف المرئيات، أو أنشئ حسابًا لتشترك في القنوات وتحفظ ما تريد الرجوع إليه.' end
    and "id" not in (select "id" from "pages_backup_0022");

update "pages" set
  "blocks" = case "locale" when 'en' then '[{"id":"hero","type":"hero","appearance":{"align":"center","width":"full","tone":"night","space":"l"},"eyebrow":"","title":"","subtitle":"Al Ummah Now is a platform where you can share videos, Shorts and community posts.","background":"gradient","media_id":null,"alt":"","height":"m","buttons":[]},{"id":"find","type":"stats","appearance":{"align":"center","width":"wide","tone":"soft","space":"m"},"heading":"What you''ll find here","variant":"features","items":[{"value":"","label":"Watch and share videos and Shorts.","text":"","icon":"play"},{"value":"","label":"Read community posts from the channels you subscribe to.","text":"","icon":"posts"},{"value":"","label":"Share news that matters to the Ummah.","text":"","icon":"news"},{"value":"","label":"Share educational materials.","text":"","icon":"book"},{"value":"","label":"Watch live streams as they happen.","text":"","icon":"live"}]},{"id":"start","type":"markdown","appearance":{"align":"center","width":"content","tone":"soft","space":"m"},"text":"## Get started\n\nExplore videos, or create an account to subscribe to channels and save what you want to come back to."}]' when 'ar' then '[{"id":"hero","type":"hero","appearance":{"align":"center","width":"full","tone":"night","space":"l"},"eyebrow":"","title":"","subtitle":"الأمة الآن منصة تشارك فيها المرئيات والمقاطع القصيرة ومنشورات المجتمع.","background":"gradient","media_id":null,"alt":"","height":"m","buttons":[]},{"id":"find","type":"stats","appearance":{"align":"center","width":"wide","tone":"soft","space":"m"},"heading":"ماذا تجد هنا؟","variant":"features","items":[{"value":"","label":"شاهد المرئيات والمقاطع القصيرة وشاركها.","text":"","icon":"play"},{"value":"","label":"اقرأ منشورات المجتمع من القنوات التي تشترك فيها.","text":"","icon":"posts"},{"value":"","label":"شارك الأخبار التي تهمّ الأمة.","text":"","icon":"news"},{"value":"","label":"شارك المواد التعليمية.","text":"","icon":"book"},{"value":"","label":"شاهد البث المباشر لحظة بلحظة.","text":"","icon":"live"}]},{"id":"start","type":"markdown","appearance":{"align":"center","width":"content","tone":"soft","space":"m"},"text":"## ابدأ الآن\n\nاستكشف المرئيات، أو أنشئ حسابًا لتشترك في القنوات وتحفظ ما تريد الرجوع إليه."}]' end,
  "body" = case "locale" when 'en' then 'Al Ummah Now is a platform where you can share videos, Shorts and community posts.

## What you''ll find here

- Watch and share videos and Shorts.
- Read community posts from the channels you subscribe to.
- Share news that matters to the Ummah.
- Share educational materials.
- Watch live streams as they happen.

## Get started

Explore videos, or create an account to subscribe to channels and save what you want to come back to.' when 'ar' then 'الأمة الآن منصة تشارك فيها المرئيات والمقاطع القصيرة ومنشورات المجتمع.

## ماذا تجد هنا؟

- شاهد المرئيات والمقاطع القصيرة وشاركها.
- اقرأ منشورات المجتمع من القنوات التي تشترك فيها.
- شارك الأخبار التي تهمّ الأمة.
- شارك المواد التعليمية.
- شاهد البث المباشر لحظة بلحظة.

## ابدأ الآن

استكشف المرئيات، أو أنشئ حسابًا لتشترك في القنوات وتحفظ ما تريد الرجوع إليه.' end,
  "updated_at" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where "id" in (select "id" from "pages_backup_0022")
    and "body" = case "locale" when 'en' then 'Al Ummah Now is a platform where you can share videos, Shorts and community posts.

## What you''ll find here

- Watch and share **videos and Shorts**.
- Read **community posts** from the channels you subscribe to.
- Share **news** that matters to the Ummah.
- Share **educational materials**.
- Watch **live streams** as they happen.

## Get started

Explore videos, or create an account to subscribe to channels and save what you want to come back to.' when 'ar' then 'الأمة الآن منصة تشارك فيها المرئيات والمقاطع القصيرة ومنشورات المجتمع.

## ماذا تجد هنا؟

- شاهد **المرئيات والمقاطع القصيرة** وشاركها.
- اقرأ **منشورات المجتمع** من القنوات التي تشترك فيها.
- شارك **الأخبار** التي تهمّ الأمة.
- شارك **المواد التعليمية**.
- شاهد **البث المباشر** لحظة بلحظة.

## ابدأ الآن

استكشف المرئيات، أو أنشئ حسابًا لتشترك في القنوات وتحفظ ما تريد الرجوع إليه.' end;
