-- 0023_about_copy_tone: the seeded About page drops "educational materials" / «المواد التعليمية»
-- (Copy Tone Guide: the platform is never described as learning, lessons or educational material).
-- The line becomes "Share your videos and posts with the community." / «شارك مرئياتك ومنشوراتك مع
-- المجتمع.», and its feature-list icon goes from a book to people.
-- Never edit this file after it is merged; add a new migration instead.
--
-- Only the seeded About page (translation_key 'www-about', slug 'about', en and ar) changes, and only
-- that one line, wherever it still reads as 0021/0022 seeded it: in the markdown body, in a markdown
-- block, and in the feature list's label. Anything else an editor wrote is left as it is. Every row
-- changed is copied to pages_backup_0023 first, so the change can be undone by hand.
-- migration-guard: allow-data-rewrite pages
create table if not exists "pages_backup_0023" as select * from "pages" where 0;
insert into "pages_backup_0023"
  select * from "pages"
  where "translation_key" = 'www-about' and "slug" = 'about' and "locale" in ('en', 'ar')
    and ("body" like '%educational materials%' or "blocks" like '%educational materials%'
      or "body" like '%المواد التعليمية%' or "blocks" like '%المواد التعليمية%')
    and "id" not in (select "id" from "pages_backup_0023");

update "pages" set
  "body" = replace(replace(replace(replace("body",
    'Share **educational materials**.', 'Share **your videos and posts** with the community.'),
    'Share educational materials.', 'Share your videos and posts with the community.'),
    'شارك **المواد التعليمية**.', 'شارك **مرئياتك ومنشوراتك** مع المجتمع.'),
    'شارك المواد التعليمية.', 'شارك مرئياتك ومنشوراتك مع المجتمع.'),
  "blocks" = replace(replace(replace(replace(replace(replace("blocks",
    '"label":"Share educational materials.","text":"","icon":"book"', '"label":"Share your videos and posts with the community.","text":"","icon":"users"'),
    '"label":"شارك المواد التعليمية.","text":"","icon":"book"', '"label":"شارك مرئياتك ومنشوراتك مع المجتمع.","text":"","icon":"users"'),
    'Share **educational materials**.', 'Share **your videos and posts** with the community.'),
    'Share educational materials.', 'Share your videos and posts with the community.'),
    'شارك **المواد التعليمية**.', 'شارك **مرئياتك ومنشوراتك** مع المجتمع.'),
    'شارك المواد التعليمية.', 'شارك مرئياتك ومنشوراتك مع المجتمع.')
  where "id" in (select "id" from "pages_backup_0023");
