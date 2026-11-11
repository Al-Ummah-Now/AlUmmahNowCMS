# CMS admin UI on top of bknd — Spec

**Status:** v1, 2026-11-09
**Owner decision:** keep bknd (code mode, inside our Worker) for storage, the data API, uploads and
permissions. Replace bknd's admin UI with our own staff screens, "if it's enough and we cover all
cases". §1 is the proof: every case, where it lives today, and how a custom UI does it on top of bknd.
**Related:** `docs/SPEC.md` (CMS v1), `docs/PUBLIC_API.md` (the www contract, unchanged by this
work), AlUmmahNow `docs/design/THEMES.md` and `docs/design/DESIGN-INTENT.md` (proto/theme-demos),
AlUmmahNow #492 (`site.theme`), AlUmmahNowAuth #257 (sign-in follows `site.theme`).

## 0. Verdict

bknd's HTTP API covers every staff case. Five cases need a small endpoint in our Worker because
bknd's permissions or data flow don't fit a browser client; none needs a bknd change or fork:

| Gap | Why bknd alone isn't enough | Our endpoint |
|---|---|---|
| Cover alt text | The alt lives in `media.metadata.alt` (`src/routes/public-api.ts:98`). Editors may not update the `media` entity (`src/bknd-config.ts:34-35` limits create/update to content entities), and widening that would let editors repoint any file's `path`. | `PATCH /admin/api/media/:id/alt` — session role admin or editor, validates ≤ 300 chars, writes `metadata.alt` only through `app.em.mutator("media")`. |
| Re-picking the video of an existing curated row | The `snapshot` must be taken server-side from the public videos API (`src/routes/picker.ts:249-268`); a browser PATCH could write any snapshot. | `PUT /picker/api/items/:id` — same validation and server snapshot as `POST /picker/api/items`, then `updateOne`. |
| Replacing a cover leaves a stale row (found while building) | bknd 0.21's `?overwrite=true` entity upload deletes the old file from R2 but keeps the old `media` row; the public API reads the first `<entity>.cover` row, so www would point at a deleted file. | After a successful entity upload the Worker keeps only the newest `max_items` rows and their files (`src/admin/media-cleanup.ts`). |
| Search combined with filters (found while building) | bknd 0.21 joins a `$or` group to its sibling conditions with OR, so `{status: "draft", $or: {title, slug}}` also returns published rows. | The list runs two AND-only bknd queries (title match, address match) with the filters and merges them in the Worker (`src/admin/screens/content.tsx`, capped at 500 per branch). |
| Time comparisons in a list filter (found while building #7) | bknd 0.21's guard validates `$gt`/`$lte` as numbers only, and `publish_at` is an ISO string. | The Scheduled/Published filters and the overview ask bknd for "has a schedule" (`publish_at: {$isnull: false}`) and compare the time in the Worker (`listWheres`, capped at 500 per branch). |
| List totals (found while building #7) | bknd 0.21's list `meta` has no total (only `items`), so counts and the pager stopped at one page. | `Data.list`/`Data.count` read the total from `POST /api/data/entity/:e/fn/count`. |
| The site theme | `site.theme` is owned by the videos admin (AlUmmahNow #492, `GET <ADMIN_API_URL>/public/site-theme`), not by the CMS. | Server-side read in the Worker (30 s cache, 500 ms timeout, Fawanees on any failure). No CMS endpoint. |

Schema editing (bknd's schema builder, `/data/schema`, `/api/data/sync`) stays code-only: the model is
`src/schema.ts` + `migrations/`, `/api/data/sync` is already blocked (`src/lib/paths.ts:14`), and the new
UI has no schema screens. bknd's flows and module-config editors are not used and get no screens
(config writes are blocked, `src/lib/paths.ts:15`).

## 1. Case inventory

Columns: **Evidence** = where the case is defined today. **bknd admin today** = what staff do in
bknd's UI (`/data/entity/...`, `/media`, `/auth/...`). **Custom UI on bknd** = the call the new UI makes.
All `/api/*` calls are same-origin `fetch` with the session cookie (`auth`, HttpOnly) and a JSON body;
bknd's guard enforces the role (`src/bknd-config.ts:25-52`), the wrapper enforces same-origin
`Origin` on mutations (`src/index.ts:154-161`) and the upload policy (`src/index.ts:165-173`), and the
content-rules plugin runs on every write (`src/lib/content-rules.ts:97-124`).

### 1.1 Entities and fields (`src/schema.ts`)

| # | Entity.field | Evidence | Type / rule | Custom UI control | bknd API |
|---|---|---|---|---|---|
| E1 | pages.slug | schema.ts:30, unique (slug, locale) :114; "home" reserved content-rules.ts:55 | text, `^[a-z0-9]+(?:-[a-z0-9]+)*$`, required | text input, slug generated from the title as it is typed (Arabic transliterated, `src/lib/slug.ts`) until edited, then "Regenerate from title"; a taken generated slug saves as -2, -3; digits-only typed slugs refused; a live row's slug is locked behind an in-app warning (www keeps no redirects); pattern + reserved check client-side, uniqueness pre-check. The data API fills a missing slug the same way (content-rules) | `POST /api/data/entity/pages/fn/exists` `{slug, locale}` |
| E2 | pages.locale | :31 | enum en/ar, required | locale segmented control (create); fixed after create, shown as a badge | create body |
| E3 | pages.translation_key | :32 | text | "Translations" panel: linked versions, "Add Arabic/English version" creates a sibling with the same key (a new UUID is set on both when empty) | `GET /api/data/entity/pages?where={"translation_key":k}`; `PATCH` |
| E4 | pages.title | :33 | text, required | text input (dir follows the row's locale) | create/update |
| E5 | pages.summary | :34 | text | textarea | |
| E6 | pages.body | :35, `::video[ID]` lines (PUBLIC_API.md:29) | markdown, HTML not rendered | markdown editor with toolbar, write/preview tabs, **"Insert video"** opens the picker dialog and inserts `::video[ID]` on its own line | |
| E7 | pages.status | :36, default draft :19 | draft/published | status pill + Publish / Unpublish action | `PATCH {status}` |
| E8 | pages.published_at | :37; set on first publish, never moved content-rules.ts:83-89 | datetime | read-only "First published" | (server rule) |
| E9 | pages.seo_title, seo_description | :38-39 | text | "Search & sharing" section with a search-result preview and length hints | |
| E10 | pages.cover | :40, media ref `pages.cover` (public-api.ts:83-104) | medium (max 1) | cover card: drop zone, replace, remove (admin), alt text | upload `POST /api/media/entity/pages/:id/cover?overwrite=true`; remove `DELETE /api/media/file/:path` (admin); alt via our endpoint (§0) |
| E11 | pages.show_in_sitemap | :41 | boolean, default true | switch | |
| E12a | pages.publish_at, posts.publish_at (#7) | migrations/0003; rules content-rules.ts; live filter src/lib/schedule.ts | datetime, NULL = live when published | Publishing panel: "Publish later" (datetime-local in the editor's own time zone, zone shown), Schedule; a scheduled row shows "Goes live <local time>", Save / Publish now / Unschedule / Change the time. Lists: Scheduled badge and filter; Overview: Scheduled count and "Coming up" | `PATCH {status: "published", publish_at, updated_at}` (same lock) |
| E12b | content history (#8) | `content_revisions`, src/lib/revisions.ts, src/admin/screens/history.tsx | every create/update/restore of a page or post: who, when, full row, changed fields | editor History card (latest 3) → `/pages/:id/history`, `/posts/:id/history`: versions (20 per page), the selected version's changes vs the previous one (before/after, line diff for long text), Restore this version (confirm) | `POST /admin/api/revisions/:id/restore {updated_at}`: restorable fields only (status, schedule, language, translation link and cover stay), same optimistic lock (409 conflict), recorded as a restore; mass PATCH and array-body POST on content entities refused (they skip bknd's events) |
| E12 | pages.created_at, updated_at | :21-24, set by content-rules.ts:91-95 | hidden datetimes | "Updated 3 min ago" meta; list sort | (server rule) |
| E13 | posts.slug/locale/translation_key/title/body/status/published_at/seo_*/cover/timestamps | :49-63 | as pages | as pages | as pages, entity `posts` |
| E14 | posts.excerpt | :53 | text | textarea | |
| E15 | posts.author_name | :57 | text | text input | |
| E16 | posts.tags | :58, array of strings content-rules.ts:58-62 | json string[] | tag input (chips, Enter/comma adds, Backspace removes) | JSON array in body |
| E17 | nav_items.menu | :69 | header/footer, required | two tabs: Header, Footer | `where {menu, locale}` |
| E18 | nav_items.locale | :70 | en/ar | locale switch on the screen | |
| E19 | nav_items.label | :71 | text, required | inline row editor | |
| E20 | nav_items.url | :72, rule content-rules.ts:26-34 | relative "/…" or https | input with the same rule client-side; server error shown inline | |
| E21 | nav_items.sort | :73 | number | drag handle + Move up/down buttons (keyboard) | `PATCH {sort}` per moved row |
| E22 | nav_items.status | :74 | draft/published | visibility switch per row | `PATCH {status}` |
| E23 | curated_videos.kind | :82 | video/playlist/channel | picker kind tabs | via picker endpoints |
| E24 | curated_videos.ref_id | :83, `REF_ID` content-rules.ts:44,71-73 | text | set only by picking (never typed) | `POST /picker/api/items`, `PUT /picker/api/items/:id` (§0) |
| E25 | curated_videos.placement | :84 | home/videos | two shelves: Home, Videos page | `where {placement}` |
| E26 | curated_videos.locale | :85 | en/ar/all, default all | segmented control per row | `PATCH` |
| E27 | curated_videos.title_override | :86 | text | inline input with the snapshot title as placeholder | `PATCH` |
| E28 | curated_videos.sort | :87 | number | drag + Move up/down | `PATCH {sort}` |
| E29 | curated_videos.status | :88 | draft/published | switch | `PATCH` |
| E30 | curated_videos.snapshot | :89, shape rule content-rules.ts:74-80 | json | thumbnail, title, channel shown; refreshed on re-pick | server only |
| E31 | site_settings.locale | :95, unique :116 | en/ar | one form per locale (tabs) | `GET ?where={"locale":l}`; create if missing |
| E32 | site_settings.site_title | :96, required | text | input | |
| E33 | site_settings.tagline, hero_title, hero_body | :97-100 | text | inputs + a hero preview card | |
| E34 | site_settings.social | :102, rule content-rules.ts:64-68 | json {kind,url}[] | repeatable rows: kind select (x, youtube, instagram, facebook, telegram, whatsapp, tiktok, other) + https URL, reorder, remove | JSON array |
| E35 | users (sso_sub, email, role, strategy) | :108-110, migrations/0001_init.sql:13 | system entity, an SSO cache | read-only list for admins: email and CMS role; roles are changed in auth's user admin (linked) | `GET /api/data/entity/users` (admin) |
| E36 | media (path, mime_type, size, reference, entity_id, metadata) | :111, 0001_init.sql:18 | system entity | Media library grid: thumbnail, name, size, used by (reference + entity), alt | `GET /api/data/entity/media`; `GET /api/media/files` |

### 1.2 Staff actions bknd's admin offers today, and how the custom UI does them

| # | Action | bknd admin today | Custom UI | bknd API / endpoint |
|---|---|---|---|---|
| A1 | List rows | `/data/entity/:e` table, 10/25/50 per page | content table/cards per entity, 20 per page, server-rendered first page | `GET /api/data/entity/:e?limit=&offset=&sort=&select=` (count in `meta`) |
| A2 | Filter | generic `where` builder | chips: status (draft/published), locale (en/ar), menu, placement | `where={"status":"draft","locale":"ar"}` |
| A3 | Search | the generic `where` filter builder (no free-text box across fields) | search box over title + address (pages, posts; the header search goes here too) | two queries, `where={"title":{"$like":"*q*"},…filters}` and the same on `slug`, merged (§0) |
| A4 | Sort | column header sort | sort menu: updated, published, title, slug | `sort=-updated_at` |
| A5 | Create | `/data/entity/:e/create` generic form | per-entity editor (§3) | `POST /api/data/entity/:e` |
| A6 | Edit | `/data/entity/:e/edit/:id` | per-entity editor with unsaved-changes guard | `PATCH /api/data/entity/:e/:id` |
| A7 | Delete | delete button (admin only by guard) | admin only: Delete in the editor's "More" menu with a confirm dialog; hidden for editors | `DELETE /api/data/entity/:e/:id` (guard: editors 403, `bknd-config.ts:28-50`) |
| A8 | Reorder | edit the `sort` number by hand | drag handle and Move up/down; renumbers in steps of 10 and PATCHes only rows whose sort changed | `PATCH /api/data/entity/:e/:id {sort}` |
| A9 | Relations | the cover media relation in the edit form | cover card (E10) | media entity upload |
| A10 | Drafts and publish | the `status` enum field | Save draft / Publish / Unpublish buttons; draft rows are never in the public API (`public-api.ts` filters `status='published'`) | `PATCH {status}` |
| A11 | Media upload | `/media` dropzone and per-field upload | Media library upload + cover upload; images only (jpeg/png/webp/avif) ≤ 10 MB, checked client-side and by the wrapper (`src/lib/paths.ts:20-41`, `src/index.ts:24-36`) | `POST /api/media/upload/:filename`, `POST /api/media/entity/:e/:id/cover?overwrite=true` |
| A12 | Media replace | upload again with overwrite | "Replace image" on the cover card | `?overwrite=true` (bknd deletes the old file after the insert) |
| A13 | Media delete | `/media` delete (needs `media.file.delete`: admins only) | admin only, confirm dialog; warns when the file is a cover | `DELETE /api/media/file/:path` |
| A14 | Permissions / roles | `/auth/roles` read-only in code mode; users list | Users screen (admin, read-only) explaining the mapping Super Admin/Admin → admin, Moderator → editor (`src/lib/roles.ts:12-16`), with a link to auth's user admin | `GET /api/data/entity/users` |
| A15 | Settings (module config) | `/settings` viewer; writes blocked (`paths.ts:15`) | not offered (code-only) | — |
| A16 | Schema builder | `/data/schema` | not offered (code-only, see §0) | — |
| A17 | Flows / tools | `/flows`, `/tools` | not offered (unused) | — |
| A18 | Account / sign out | injected links (`src/lib/admin-ui.ts:9-13`) | account menu in the header: name, role, Accounts (`/sso/accounts`), Sign out (`/sso/logout`) | existing SSO routes |
| A19 | Session expiry while open | injected watcher (`src/lib/admin-ui.ts:21-35`) | the same watcher in the new shell (focus, visibility, 5 min) | `GET /api/auth/me` |
| A20 | Video picker | separate `/picker` page (`src/routes/picker.ts:197-271`) | the picker is a dialog **inside** the curated-videos screen and the page/post body editor; `/picker` redirects to `/videos` | `/picker/api/search`, `/picker/api/items` |

### 1.3 What www depends on (must not change)

| # | Dependency | Evidence | Guard |
|---|---|---|---|
| W1 | `/api/public/v1/{site,home,pages/:slug,posts,posts/:slug,videos,sitemap,media/*}` shapes, headers, ETag | `src/routes/public-api.ts:247-395`, `docs/PUBLIC_API.md` | untouched files; a contract test (§8) snapshots every response shape for fixed fixtures |
| W2 | Drafts never served | public-api.ts every query `status='published'` | existing tests + the contract test |
| W3 | `cover` = first media row with `reference = '<entity>.cover'`, alt/width/height from `metadata` | public-api.ts:83-104 | the alt endpoint writes `metadata.alt` only; uploads keep bknd's metadata |
| W4 | `::video[ID]` lines in bodies | AlUmmahNowUI `src/lib/markdown.ts:10` (`^::video\[([^\]\n]{1,80})\]\s*$`) | "Insert video" writes exactly that line |
| W5 | nav url format, reserved slug, tags shape, snapshot shape | content-rules.ts | unchanged plugin; the UI pre-validates with the same functions (shared module) |

### 1.4 Cases bknd's admin cannot do, and how the custom UI does them

| # | Case | Custom UI |
|---|---|---|
| X1 | Pick videos inside edit screens | Picker dialog component (search by kind, results with thumbnails, preview embed, choose). Used by Videos (add / change video) and by the body editor ("Insert video"). |
| X2 | Arabic and English content with RTL | The UI language (`?lang=`, cookie `cms_lang`, `Accept-Language`, as `src/lib/i18n.ts`) sets `<html lang dir>`. Every content field also gets `dir` and `lang` from the **row's** locale, so an Arabic page edited in the English UI is typed RTL. Lists show each title in its own direction (`dir="auto"` + `lang`). |
| X3 | The four themes | The active theme comes from `site.theme` (§5). Each theme is a material (DESIGN-INTENT.md), not a recolour: page atmosphere, header, rail, cards, primary, active item and borders come from the theme's material variables. |
| X4 | Light and dark | Follows the device; a toggle in the rail foot (System, Light, Dark) stored in cookie `cms_mode`, rendered on the server (no flash). |
| X5 | Translation linking | Translations panel (E3). |
| X6 | Live preview on www | "View on site" link for published rows (`${WWW_URL}/${locale}/${slug}` for pages, `/${locale}/articles/${slug}` for posts; www serves posts in its Articles section under `/articles/`, and 301s the old `/news/` urls). Saved drafts get **"Preview on site"** instead: `/preview/{kind}/{id}` mints a 30-minute token for that row and opens www's preview (banner, noindex, never cached). With unsaved edits the editor asks for a save first. See `docs/PUBLIC_API.md` "Preview API". |
| X7 | Unsaved changes | A "You have unsaved changes" bar, and an in-app "Leave this page?" dialog (Stay / Leave anyway) on in-app links while there are unsaved changes or an upload is running. Never the browser's own prompts (no `confirm` / `prompt` / `alert`, no leave-page prompt on reload or close; ESLint forbids them). Unpublish, Unschedule and Remove cover ask in the confirm dialog; deletes ask with an optional reason and go to Recently deleted (docs/SOFT_DELETE.md), whose "Delete permanently" is type-to-confirm (`src/admin/client/dialogs.ts`). |

Nothing in the inventory needs a bknd change. **Exceptions: none blocking**; the Worker additions
in §0 are the only server changes.

## 2. Screens and routes

All routes are SSO-gated (the existing session gate, `src/index.ts:128-143`), server-rendered by the
Worker with Hono JSX, and enhanced by one small client script. bknd's admin UI moves off `/` (§9).

| Route | Screen | Roles |
|---|---|---|
| `/` | Overview: counts (drafts, published) per entity, recent edits, quick actions (New page, New post, Add video), the active theme | admin, editor |
| `/pages`, `/pages/new`, `/pages/:id` | Pages list, create, edit | admin, editor (delete: admin) |
| `/posts`, `/posts/new`, `/posts/:id` | Posts list, create, edit | admin, editor (delete: admin) |
| `/navigation?menu=&locale=` | Header and footer menus, inline rows, reorder | admin, editor (delete: admin) |
| `/videos?placement=` | Home and Videos-page shelves, picker dialog, reorder | admin, editor (delete: admin) |
| `/site?locale=` | Site settings per locale, hero preview, social links | admin, editor (bknd guard: editors may update `site_settings`, `CONTENT_ENTITIES` schema.ts:15) |
| `/library` | Media library: upload, alt, delete (admin) | admin, editor |
| `/people` | Users (SSO cache), role mapping explained | admin |
| `/picker` | redirect → `/videos` (old links keep working) | |
| `/admin-assets/*` | our CSS/JS, content-hashed, immutable | public (no data) |
| `/admin/api/media/:id/alt` | §0 | admin, editor |
| `/picker/api/items/:id` (PUT) | §0 | admin, editor |
| `/picker/api/snapshots` (POST) | snapshot a video picked into a page block, server-side (§2.1) | admin, editor |
| `/admin/api/video-snapshots/retry` (POST) | requeue dead-lettered block video snapshots (Overview flag) | admin, editor |

Screen anatomy (shared): header (brand + theme wordmark at the start, global search across pages and
posts in the centre, New and the account menu at the end), a 76 px rail with icon+label items
(Overview, Pages, Posts, Navigation, Videos, Site, Library, People) that becomes a drawer and a bottom
bar on phones, and the language and mode controls at the rail foot. Lists use cards on phones and a
table on wide screens. Editors are two columns on wide screens (content | publish panel, cover,
translations, SEO) and one column on phones with a sticky action bar.

### 2.1 Page blocks and card posts

**Page content** replaces the page's markdown field with a block list (`src/admin/screens/blocks.tsx`,
`src/admin/client/blocks.ts`). *Add a block* is a grid of eleven named cards (icon, name and what it
is for; two compact columns on phones). Each block is a card with its type icon and name, and named
icon buttons: Move up, Move down, Duplicate, Remove (no bare "+" anywhere). Reorder by those buttons,
by Alt+↑/↓ from any field in the block, or by dragging the grip; every move, add, duplicate and
remove is announced in an `aria-live` region, and Remove offers Undo. Focus lands in the new block's
first field, and stays on the moved item. Images come from the **media chooser** (library grid with
paging, or upload: names are generated, so an upload never replaces a file); the alt text defaults
to the library's description. Posts are picked from a search dialog in the page's language; videos
with the existing picker, snapshotted server-side. *Preview* shows the blocks as they read, in the
page's language and direction; *Preview on site* shows the finished design. Incomplete blocks are
marked "Hidden on the site until it is complete". Prose fields are spell-checked in the page's
language; links are not. A bad block is refused before saving, with the message on that block;
server errors never show raw text.

**Card posts:** the post editor has a *Post type* toggle (Article | Cards). Cards hides the body and
shows **Slides**: each slide has an image, a heading and short text (≤ 140 / 400), alt text and a
text position (Top, Middle, Bottom), with a live preview of the text over the image using the same
shade the site uses. Slides reorder, duplicate and remove like blocks; *Add slides from images* makes
one slide per chosen image.

**Overview:** a videos-in-blocks refresh that was dead-lettered (SPEC §4.2) shows as an alert with
the items' titles and **Retry now**.

## 3. Data flow

- **Reads (first paint):** the Worker reads through bknd in-process with the user's own request, so
  the guard applies: `app.server.request(...)`/`bknd.fetch` on `/api/data/...` with the incoming
  cookie. Lists and editors render complete HTML (works without JS for reading).
- **Writes:** the client script submits forms as JSON to bknd's API (`/api/data/entity/...`), shows
  field errors from bknd's 400 responses and the content-rules messages, then updates the DOM or
  navigates. Uploads go to bknd's media endpoints with `FormData`.
- **Concurrency:** the editor sends `updated_at` it loaded; before saving, the client re-reads the
  row and warns "Changed by someone else since you opened it" if `updated_at` moved (bknd has no
  conditional update; this is a best-effort check).
- **Validation:** `src/lib/content-rules.ts` validators are imported by the client bundle too, so the
  UI and the server agree.

## 4. Auth and permissions

Unchanged model (SPEC §3): SSO → bknd session cookie; Super Admin/Admin → `admin`, Moderator →
`editor`; anyone else → 403 page. The new UI hides actions a role can't perform (Delete, Media delete,
People) **and** bknd's guard still refuses them (the UI is not the authority). Every new route sits
behind the existing session gate; the two new endpoints check the role again and require JSON and a
same-origin `Origin`.

## 5. Themes (fanous-tokens)

- **Which theme:** `site.theme` from `GET ${ADMIN_API_URL}/public/site-theme` (AlUmmahNow #492),
  cached 30 s per isolate, 500 ms timeout, **Fawanees** when unset, unknown, slow or failing (the same
  rules as www and auth #257). New var `ADMIN_API_URL` per env. On QA and stage only, `?theme=<id>`
  previews a theme for that browser (cookie `cms_theme_preview`, cleared by `?theme=site`) so all four
  can be checked before #492 ships; production ignores it (THEMES.md: no user theme choice).
- **Consuming fanous-tokens outside the monorepo:** the package is private and unpublished
  (`packages/fanous-tokens/package.json`: `"private": true`). Options: publish to GitHub Packages
  (needs a `read:packages` token in every CI and dev setup, and a release flow for the monorepo), an npm
  git dependency (npm can't install a sub-directory; it would pull the whole monorepo), or **vendoring
  the generated web output at a pinned commit**. Chosen: vendoring, because the generator already
  emits plain CSS, the monorepo is public, and a pin makes every theme change a reviewed PR here (the
  auth repo does the same in #257).
  - `scripts/sync-fanous.ts --ref <sha>` downloads, for each theme in `themes/registry.json`,
    `generated/<id>/web/tokens.css` and `themes/<id>/assets/auth-header.{light,dark}.svg`, plus the
    per-theme material CSS from the demo (`apps/web/src/theme/materials/<id>.css`, until it lands on
    main), rescopes `:root` to `html[data-theme=<id>]` and the mode selectors to `[data-mode]`, and
    writes `src/admin/theme/vendor.generated.ts` with `fanous.lock.json` (`{ repo, refs, files: { path:
    sha256 } }`).
  - CI (`npm run check:fanous`) recomputes the hashes offline; a mismatch or a hand edit fails.
  - Pins today: tokens and assets `AlUmmahNow@b225ea5a` (main), materials `AlUmmahNow@399086fc`
    (proto/theme-demos).
- **Per response:** only the active theme's CSS is sent (`/admin-assets/theme-<id>.<hash>.css`).
  Components use semantic and part tokens (`--fanous-color-*`, `--fanous-c-*`) and material variables
  (`--m-*`); no page code names a theme.

## 6. RTL

`<html dir>` from the UI language; logical CSS properties only (`margin-inline-start`, `inset-inline-*`,
`border-inline-start`); the rail's selected bar is on the start side; icons that point (back,
chevrons, move up/down are vertical so unaffected) flip in RTL; numbers stay Western digits (as www);
content fields take `dir`/`lang` from the row's locale (X2). Arabic typography uses the token's Arabic
scale (`--fanous-type-arabic-*`).

## 7. Accessibility

WCAG 2.1 AA: tokens are contrast-checked by fanous-tokens CI per theme and mode; every control is a
native element with a visible label; 44 px targets; skip link; one `h1` per screen; landmarks
(header, nav, main); focus-visible rings from `--fanous-color-focus-ring`; dialogs (picker, confirm)
trap focus, close on Escape and return focus; status and errors through `role="status"`/`aria-live`;
reorder works with buttons, not only drag; reduced motion respected. axe runs in E2E on every screen.

## 8. Testing plan

- **Worker tests (Vitest, workerd):** every route renders for admin and editor, en and ar
  (`dir="rtl"`), each theme and mode attribute; editors don't see delete controls and bknd refuses
  their deletes; the alt and re-pick endpoints (roles, validation, same-origin, snapshot server-side);
  theme resolution (default, valid, unknown, timeout, preview param ignored in production).
- **Public API contract test:** a fixed fixture set (pages, posts, nav, videos, settings, cover media)
  is written **through the new UI's API calls**, then every public endpoint's response is compared
  with a committed snapshot of the current shapes and values (`test/worker/public-api-contract.test.ts`).
  Any change to what www receives fails CI.
- **E2E (Playwright, QA):** one test per inventory row group: E1-E16 (pages and posts create, edit,
  slug rules, translations, tags, SEO, cover upload/replace/alt, publish/unpublish, delete as admin,
  no delete as editor), E17-E22 (nav add, edit, reorder, hide, URL rule), E23-E30 (picker dialog
  search, add, change video, reorder, locale, override, publish), E31-E34 (settings per locale, social
  rows), E35 (people admin-only), E36/A11-A13 (library upload, type and size rejection, delete), A3/A2/A4
  (search, filters, sort), X1-X4 (picker in body editor inserts `::video[ID]`; ar UI RTL; four themes via
  the preview param; light and dark), plus "published content appears on www" and axe on every screen.
  Runs in Chromium, Firefox and WebKit, desktop and phone projects.
- **Page builder and card posts** (`e2e/blocks.spec.ts`): build a page from blocks with uploads
  through the chooser, keyboard and drag reorder, duplicate, remove and Undo, a refused bad link,
  preview, publish, and the public API's `blocks`; the Arabic editor with axe; a card post with
  slides, the live overlay, keyboard reorder, publish, the post's `slides` and `/cards`. The gallery
  (`e2e/gallery.spec.ts`) includes a built page, a card post and the media chooser.

## 9. Retiring bknd's admin UI

Options: (a) remove it from staff routes, or (b) keep it locked to admins as a fallback.

**Recommendation: (a) remove it** (done in the last PR of this work), after the E2E suite proves parity on
QA. Reasons: one UI to keep correct; bknd's SPA needs `style-src 'unsafe-inline'` (`src/lib/security.ts:13`)
and an injected session watcher; it can't follow the themes, RTL or the picker; and the data API stays
for emergencies (admins can still call `/api/data/*`). The fallback is a rollback (the release
workflow can roll back to the previous tag), not a second UI.

Transition: while the screens land, bknd's admin moves from `/` to `/bknd/` and is limited to the
`admin` role. The final PR removes `/bknd`, `adminOptions`, the injected links and watcher
(`src/lib/admin-ui.ts`), bknd's static assets binding, and the old admin paths in `isAdminUiPath`
(old `/data/...` links redirect to the matching new screen).

## 10. Delivery

| PR | Content |
|---|---|
| 1 | This spec |
| 2 | Foundation: vendored themes + check, Hono JSX shell (header, rail, drawer, bottom bar, account menu, language and mode), components, Overview, theme resolution, bknd admin to `/bknd` (admin) |
| 3 | Pages and posts: lists (search, filters, sort, paging), editor (markdown, insert video, cover, alt, SEO, translations, publish, delete) |
| 4 | Navigation, Videos (picker dialog, re-pick endpoint), Site settings, Library, People |
| 5 | Retire bknd's admin UI, cross-browser E2E for every case, the public API contract test |

Each PR merges once its CI is green (`gh pr merge --rebase --admin`); main deploys to QA. Production
only from a `vYYYY.MM.DD` tag cut by the owner.
