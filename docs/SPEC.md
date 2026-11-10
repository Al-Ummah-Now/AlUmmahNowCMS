# cms.alummahnow.net — Spec

**Status:** v1.1, 2026-11-08 (§3/§7: public PKCE client, no client secret)
**Owner intent:** "The UI should be for www and CMS its admin."
**Related:** AlUmmahNowUI `docs/SPEC.md` (the only consumer of the public API), AlUmmahNowAuth
(SSO, `oauth_clients`), AlUmmahNow videos API (picker source), AlUmmahNow `docs/embeds/README.md`.

## 1. Assessment of what exists (2026-11-08)

- The repo has docs (README, ARCHITECTURE, ROADMAP) describing an aspirational CMS, plus a
  10-line bknd 0.12 Worker (`serve({ mode: "warm" })` and a `/custom` demo route). It has never
  been deployed: Worker `bknd` has no deployments. D1 `al-ummah-now-cms` and R2 `al-ummah-now-cms`
  exist and are empty.
- bknd gives us: a data module (entities, relations, a REST API at `/api/data/*`, a generated
  admin UI at `/`), a media module (uploads to R2 via a binding), an auth module (users table,
  password/OAuth strategies, a role/permission **guard**, signed-JWT cookie sessions), and a code
  mode (schema and config from code on every boot, admin UI read-only for configuration).
- bknd 0.12 has no code mode, and its config lives in D1, editable from the UI. That would let
  anyone with UI access change the data model with no migration. **Decision: upgrade to the
  current bknd (0.21.x) and run in code mode.** Nothing is deployed, so no data is at risk.
- bknd's own users and passwords are **not** used for sign-in (owner rule: SSO only). bknd's
  users table becomes a cache of SSO identities so the guard and audit fields work.

## 2. Hosts and environments

| Env | Host | Worker | D1 | R2 |
|---|---|---|---|---|
| prod | `https://cms.alummahnow.net` | `al-ummah-now-cms` | `al-ummah-now-cms` (existing `ad825428-…`) | `al-ummah-now-cms` |
| stage | `https://cms.stage.alummahnow.net` | `al-ummah-now-cms-stage` | `al-ummah-now-cms-stage` | `al-ummah-now-cms-stage` |
| QA | `https://cms.qa.alummahnow.net` | `al-ummah-now-cms-qa` | `al-ummah-now-cms-qa` | `al-ummah-now-cms-qa` |

`cms.` (the recommended host) is used: it is staff-only, separate from `admin.` (the videos
moderation admin) and from `admin.auth.` (users and roles). Custom domains create the DNS.
`workers_dev` is off. The stray `bknd` Worker name is not reused.

## 3. Access model (SSO only)

- **Auth client:** a **public PKCE client** (authorization code + PKCE S256, **no client secret**),
  one row per auth DB, added by an AlUmmahNowAuth migration (`0011_www_cms_clients.sql`, both
  `migrations/` and `migrations-qa/`).

  > **Deviation (2026-11-08, implementation PR):** v1 of this spec said "confidential client +
  > `CMS_CLIENT_SECRET`". The auth server (openauth fork) does **not** verify client secrets on the
  > `authorization_code` grant — it checks only `client_id`, the exact `redirect_uri` and PKCE — so a
  > secret would add rotation work and no protection. The CMS is therefore registered and built as a
  > public client. Protection = PKCE S256 + exact registered `redirect_uri` + signed access-token
  > verification (JWKS, `iss`, `aud` = client_id, `exp`) + the role check. There is no
  > `CMS_CLIENT_SECRET`; the secrets check fails if one is ever bound.

  | Env | client_id | redirect_uris (exact) |
  |---|---|---|
  | prod | `d06fd65a-5b79-45bc-8bfd-a856b8502330` | `https://cms.alummahnow.net/sso/callback`, `http://localhost:8585/sso/callback` |
  | stage | same id (stage replays prod migrations) | rewritten by `scripts/stage/seed.ts` to `https://cms.stage.alummahnow.net/sso/callback` |
  | QA | `0e613f49-674b-490a-93e5-97a35d586da1` | `https://cms.qa.alummahnow.net/sso/callback`, `http://localhost:8585/sso/callback` |

- **Allowed roles** (token `properties.roles`, display names normalized to snake_case):
  `super_admin` and `admin` → bknd role `admin` (everything, including media deletes and
  settings); `moderator` → bknd role `editor` (create, edit and publish pages, posts, navigation
  and curation; upload media; no deletes, no settings); `scholar` → bknd role `writer` (their own
  posts only, plus their profile; docs/SCHOLARS.md §2). Any other user gets a 403 "No access" page
  (en/ar) with a link back to www, and nothing is created. A dedicated "Content Editor" auth role
  is a queued follow-up.
- **Flow:** `/` (admin UI) and every non-public API need a bknd session. With none, the user is
  redirected to `/sso/login?return=…` → auth `/authorize` → `/sso/callback`: exchange the code,
  verify the access token (JWKS, `iss`, `exp`), check the roles, upsert the user in bknd `users`
  (`email`, `sso_sub`, `role`, `strategy = "sso"`), and issue a bknd session cookie through bknd's
  authenticator (secure, HttpOnly, SameSite=Lax, 8 h). **The role is re-derived on every sign-in**
  from the token, so a demotion in auth takes effect at the next sign-in (and the session is at
  most 8 h old).
- bknd's password and registration routes (`/api/auth/password/*`, `/api/auth/*/register`) are
  disabled: the password strategy is off and the wrapper answers 404. The guard is on. The guest
  role has **no** permissions on `/api/data/*`.
- `/sso/logout` clears the bknd cookie and redirects to auth's logout, then back to www.

## 4. Content model (bknd code mode, expand-only)

Each localized row has `locale` (`en`|`ar`) and a `translation_key` linking the language versions.
`status` is `draft` or `published`. `published_at` is set on first publish. Pages and posts also have
`publish_at` (scheduled publishing, #7, `migrations/0003`): a published row with a `publish_at` still ahead
is **scheduled** and not served; `published_at` is then the scheduled time (it moves with the schedule and is
cleared on unschedule until the row goes live). A draft never carries a `publish_at`. Every content entity
also has `created_at`/`updated_at` (maintained by `src/lib/content-rules.ts`).

| Entity | Fields |
|---|---|
| `pages` | `slug`*, `locale`*, `translation_key`, `title`*, `summary`, `body` (markdown), `status`, `published_at`, `publish_at`, `seo_title`, `seo_description`, `cover` (media), `show_in_sitemap` (bool, default true), `blocks` (json Block[], `migrations/0006`; `body` is derived from it on save) — unique (`slug`, `locale`) |
| `posts` | `slug`*, `locale`*, `translation_key`, `title`*, `excerpt`, `body` (markdown), `status`, `published_at`, `author_name`, `tags` (json string[]), `cover` (media), `seo_title`, `seo_description`, `kind` (`article`|`cards`, default `article`), `slides` (json Slide[], cards; `body` is derived from it) — unique (`slug`, `locale`) |
| `nav_items` | `menu` (`header`|`footer`)*, `locale`*, `label`*, `url`* (relative `/…` or https), `sort` (int), `status` |
| `curated_videos` | `kind` (`video`|`playlist`|`channel`)*, `ref_id`*, `placement` (`home`|`videos`)*, `locale` (`en`|`ar`|`all`), `title_override`, `sort`, `status`, `snapshot` (json: title, thumbnail and channel at pick time; display fallback only) |
| `site_settings` | `locale`* (unique), `site_title`, `tagline`, `hero_title`, `hero_body`, `social` (json) |
| `video_snapshots` | (`kind`, `ref_id`) primary key, `snapshot` (json), `attempts`, `next_attempt_at`, `last_error`, `dead_at` — snapshots of videos used in page blocks, and their refresh queue (§4.2) |
| media | bknd's media entity, R2 binding `MEDIA` |
| `content_revisions` (#8, `migrations/0005`) | not a bknd entity (Worker-only, never on the data API): `entity`, `entity_id`, `version`, `action` (create/update/restore), `actor_id`, `actor_email`, `restored_from`, `changed` (json field names), `snapshot` (json, full row), `created_at`. Written after every create/update of a page or post (`src/lib/revisions.ts`); all kept, listed 20 per page. |

### 4.1 Page blocks and card posts

A page is built from ordered blocks (`src/lib/blocks.ts`, shared by the server and the editor):
text (markdown), image, gallery, posts (latest / by tag / picked), card posts grid, video shelf,
embedded video, call to action, text beside an image, quote or callout, divider or space. A post is an
article (markdown body) or **cards**: ordered slides, each an image with a heading and short text drawn
on it at the top, middle or bottom. Blocks and slides store references only (media ids, post ids,
video refs); the public API resolves them at read time (`src/lib/blocks-public.ts`, PUBLIC_API.md
"Blocks"). Validation is in `src/lib/content-rules.ts` (400 on an invalid block, a bad CTA link, or too
many items) and `body` is rewritten on every save as the blocks' (or slides') text in markdown, so
readers that only know `body`, search and the sitemap keep working. Each locale row has its own
blocks; Add translation copies them. `migrations/0006` backs `pages` up to `pages_backup_0006`, then
turns every non-empty body into one text block (no data loss; tested on a copy in
`test/node/migration-0006.test.ts`).

### 4.2 Block video snapshots: a queue in D1

Videos in blocks are snapshotted server-side when picked (`POST /picker/api/snapshots`) into
`video_snapshots`, shared by every page that uses them. The cron runs the refresh queue
(`src/lib/video-snapshots.ts`): a row is due at `next_attempt_at` (2 h after a success), only rows a
page still uses are fetched, writes are compare-and-set on `updated_at` (overlapping runs never
overwrite a newer write), and a failure backs off 5 min · 2^(attempts−1), at most 6 h. After 8
failures in a row the row is dead-lettered: it keeps its last good snapshot, is flagged to staff on
the Overview, and Retry (`POST /admin/api/video-snapshots/retry`, admin or editor) puts it back in the
queue. An item the videos site no longer serves is kept but marked not public and left out of pages.

Expand-only rules (enforced by CI, §8): migrations only `CREATE TABLE`/`CREATE INDEX`/`ALTER TABLE …
ADD COLUMN`. No `DROP`, `RENAME` or `ALTER … DROP`. A new required field must have a default.
Removing a field from the model means stop reading it, never drop it.

## 5. Video picker

> **Update (2026-11-09):** the picker is now a dialog inside the staff screens (Videos, and Insert video in
> the page/post editor); `/picker` redirects to `/videos`. bknd's admin UI is retired. See `docs/ADMIN_UI_SPEC.md`.

`/picker` (an SSO-gated page served by the CMS Worker, en/ar, linked from the admin UI's menu
via a bknd UI link plus a Home card):
- Search videos (`GET {VIDEOS_API_URL}/api/videos/search?q=`), playlists and channels, through the
  CMS Worker as a server-side proxy (`/picker/api/search?kind=&q=`). No browser CORS, no token
  forwarded, and only public results are shown (results whose visibility isn't public are dropped).
- Pick → choose the placement, locale and sort → creates a `curated_videos` row (status draft or
  published) with a `snapshot`. The list view reorders, unpublishes and removes (admin only).
- Preview uses the embeds adapter (the same contract as www; placeholder `/embed/{id}` until AlUmmahNow
  `docs/embeds/README.md` lands).

## 6. Public read API (`/api/public/v1`, the only unauthenticated surface besides `/healthz`)

Published rows only (filter `status = 'published'` in every query; drafts are never serialized). Pages and
posts must also be live: `publish_at IS NULL OR publish_at <= now` (`LIVE_SQL`, `src/lib/schedule.ts`). This
is decided at read time, so going live needs no job or purge: www's 60 s cache and its own 5-minute KV
snapshot cron pick the row up, and the ETag changes with the body.
Responses are JSON, `Cache-Control: public, s-maxage=60, stale-while-revalidate=600`, and carry
an `ETag`. CORS: `GET` from the www origins for the env only (www calls server-side through a
service binding; CORS is for the client-side language switcher and future islands).

| GET | Returns |
|---|---|
| `/site?locale=` | settings + `nav: { header[], footer[] }` |
| `/home?locale=` | settings hero, `videos` (placement home), `posts` (latest 3) |
| `/pages/:slug?locale=` | a page + `alternates: [{ locale, slug }]` + `blocks` (resolved) |
| `/posts?locale=&page=&limit=` (≤ 20) | `{ items, page, total }` |
| `/posts/:slug?locale=` | a post + alternates |
| `/videos?locale=&placement=` | curated items |
| `/cards?locale=&tag=&page=&limit=` (≤ 24) | card posts `{ items, page, total, tags }` |
| `/sitemap` | `[{ type, locale, slug, updated_at }]` |
| `/media/:path` | the R2 object, `Cache-Control: public, max-age=31536000, immutable` (media paths are content-addressed) |

404 is JSON `{ error: "not_found" }`. Unknown locale → 400.

## 7. Security

- Session cookie `__Host-`-style attributes (Secure, HttpOnly, SameSite=Lax, Path=/, no Domain).
  bknd names it `auth` (not configurable in 0.21); the short-lived SSO state cookie is
  `__Host-cms_sso`. CSRF: bknd mutations require JSON plus a same-origin `Origin` check in the
  wrapper for non-GET `/api/*` and `/picker/api/*`. bknd's CORS (which by default reflects any
  origin with credentials) is pinned to the CMS's own origin, and the wrapper strips foreign
  `Access-Control-*` headers from every private response.
- Admin responses: `Cache-Control: private, no-store`, `X-Robots-Tag: noindex`, CSP with
  `frame-ancestors 'none'`.
- Markdown is stored raw and rendered by www with HTML disabled.
- Uploads: images only (jpeg, png, webp, avif, svg is rejected), ≤ 10 MB.
- Secrets: `BKND_JWT_SECRET` (`openssl rand -hex 32`) only — a Worker secret, never printed; the
  Worker fails closed (503 on everything but `/healthz`) without it. Listed in
  `scripts/secrets-manifest.ts` and checked before promote. No client secret (public PKCE client, §3).

## 8. Tests and release

- Unit (Vitest): role mapping, return-path guard, token verification (a local JWKS), callback
  (denied versus allowed; the user upsert re-derives the role), the public API never returns drafts,
  the picker proxy drops non-public items, the migration guard.
- **Schema check (CI):** apply `migrations/*.sql` to a fresh local D1 (`wrangler d1 migrations
  apply --local`), then `bknd sync --sql` must print **no** statements, so the code model equals
  the migrations. Plus `scripts/migration-guard.ts` rejects destructive statements and edits to
  already-merged migration files (append-only).
- E2E (Playwright, QA in CI and stage in the release): `/` unauthenticated → redirect to auth
  `/authorize` with `client_id` and the exact `redirect_uri`; a non-admin (QA viewer account) →
  403 page; an admin → admin UI loads; an admin creates and publishes a uniquely-titled post via
  the API → it appears on www (≤ 90 s) → the test unpublishes it; the public API omits drafts; axe on
  `/picker` and the 403 page.
- Release: QA from `main` on push; build once → stage (migrate, deploy, smoke, E2E) → prod
  (migrate expand-only, candidate at 0 %, override smoke, 100 %, smoke, auto-rollback) → rollback dry
  run. See `docs/PLAN.md`.
