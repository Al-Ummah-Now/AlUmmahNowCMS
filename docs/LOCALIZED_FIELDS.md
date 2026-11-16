# Localized fields

Owner rule (2026-11-16): every field that has an English and an Arabic version is set by staff in both
languages, or filled by our translation service from the other one. There is no "leave empty to use the
other language" and no silent fallback when rendering. Users' own content (posts and bios scholars write,
video titles, channel and profile text) is out of scope.

## How the CMS models languages

Most CMS content is one row per language, not a pair of columns:

| Content | Model | Missing language |
| --- | --- | --- |
| Pages, posts (incl. page-builder blocks, featured/curated lists, About) | one row per language, linked by `translation_key` | the page simply doesn't exist in that language: the public API answers 404 for it and www's language switch goes to that language's home. The editor's "Translate" (AI assist job) creates the other language as a draft. |
| Navigation menus (`nav_items`) | rows per menu and language | each language's menu is its own list; an empty CMS menu shows www's built-in menu **in the same language** (repo copy, both languages kept in step), never the other language's items. |
| Site settings (`site_settings`: title, tagline, hero) | one row per language | a missing row shows www's built-in copy in the same language (`apps/www/src/content/fallback/<locale>.ts`), never the other row. |
| A curated page's list (`page_entries`) | the page has one language | its "Title on the site" is in the page's language (input carries that `lang`/`dir`). |
| Home timeline video entries (`timeline_entries`, kind video) | `locale` en, ar or **all** | see below: the one real en/ar pair. |

## Home timeline: "Title on the site"

A video entry shown in one language has one override (`title_override`) in that language. An entry shown
in **both** languages (`locale = 'all'`) has a pair: `title_override` (English) and `title_override_ar`
(Arabic, migration 0023). Code: `src/lib/feed/overrides.ts`.

- **Saving**: both or neither. `PATCH /admin/api/timeline/entries/:key` with one side only → 400
  `ar_missing` / `en_missing`; the screen marks the empty field inline before it sends anything.
- **Rendering**: the feed for a language carries only that language's override. A missing one means the
  video's own title (user content), never the other language's override. FEED_FORMAT 6 rebuilds the stored
  feed so legacy overrides leave the language they are not written in.
- **Legacy rows** (written before 0023: one text, no Arabic column): the text belongs to the language it is
  written in (Arabic script and no Latin letters → Arabic, else English). The other language is missing:
  the row shows an "Arabic missing" / "English missing" badge, the toolbar has a **Missing a language**
  filter with a count, and the filter offers **Translate missing**.
- Changing an entry's language keeps that language's title (all → ar keeps the Arabic one; en → all keeps
  the English one and marks Arabic missing until someone fills it).

## Translate (staff)

`POST /admin/api/translate { text, from, to }` → `{ text }`, admins and editors only
(`src/lib/field-translate.ts`, `src/admin/translate-api.ts`).

- **Workers AI only**: the `translate` route's model when that route is on Workers AI, else the built-in
  default model; never an HTTP provider and never the fallback. An admin who turned Workers AI off turned
  this off too.
- **Glossary**: `translation_glossary` (migration 0017) goes into the prompt, as for page translation.
- **«مرئي / مرئيات»**: in the prompt, and enforced on the Arabic output (any فيديو form is replaced).
- **Qur'an**: detected text (﴿ ﴾, «قال تعالى», a surah:ayah reference) is refused before any call; the model
  also reports Qur'an it recognises and that answer is refused. 422 `{ error: "quran", quranUrl }`; the
  pair's status links the official text.
- **Cost**: one small call under the env's monthly AI budget; 30 calls per user per 10 minutes; 400 per env
  per UTC day (429 `daily_cap`). Every call is an `ai_usage` row with feature `field_translate` (who, when,
  model, status): the audit trail.
- **Tests**: worker tests inject `mockWorkersAi()`; `test/worker/setup.ts` replaces the real binding with one
  that throws "REAL WORKERS AI CALLED UNDER TEST". The local E2E mock server answers the same prompt.

## The shared pair component

`src/admin/ui/localized-pair.tsx` + `src/admin/client/localized-pair.ts`: English | العربية side by side, each
input with its own `lang`/`dir`, a labelled Translate button under each (into the other language), an
`aria-live` status, errors tied to their field (`aria-invalid` + `aria-describedby`), theme tokens only.

- Translate fills the other field and leaves it there to check and change; the screen's own Save stores it.
- Replacing text that was already there offers **Undo** in the status line (never a browser prompt).
- **Translate missing** (lists) fills each listed pair's empty side one by one and saves nothing: every
  result is reviewed and saved row by row.

Use it for any new staff-set field that has both languages.
