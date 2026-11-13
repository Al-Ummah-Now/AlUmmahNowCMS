# Architecture

```
browser (staff) ──► cms.alummahnow.net  (Worker al-ummah-now-cms)
                      │  src/index.ts — Hono wrapper
                      ├─ /healthz                     liveness (+ ?deep=1: config, D1, version id)
                      ├─ /api/public/v1/*             public read API (D1 SQL, published rows only) ◄── www (service binding CMS)
                      ├─ /api/preview/v1/:kind/:id    one row, any status, with a preview token     ◄── www /preview (no-store)
                      ├─ /preview/:kind/:id           staff: mint a 30-min token → 303 www/preview  ┐ session required
                      ├─ /sso/login|callback|logout   PKCE → auth.alummahnow.net, bknd session cookie
                      ├─ /sso/no-access, /sso/accounts account chooser (browser reads auth's accounts API)
                      ├─ /sso/passkey-needed          staff without a passkey sign-in after their deadline (AUTH-PASSKEYS)
                      ├─ /picker, /picker/api/*       video picker → videos.api.alummahnow.net (server-side)
                      ├─ /bknd/*, /data/*, /media/*, … 302 → the matching staff screen (bknd's admin UI is retired, CMS#30)
                      ├─ /, /pages, /posts, /timeline, … staff admin screens (src/admin, server-rendered) ┐ session required
                      ├─ /admin/api/*                  staff screens' JSON API (writers: own posts only)  │
                      ├─ /admin/api/ai/*              AI writing assist → queue AI_JOBS → provider per feature (Workers AI binding by default; admin-configured HTTP providers)
                      └─ /api/*                       bknd API (data + media; no admin UI)              ┘ guard on, same-origin mutations
                      queue  al-ummah-now-cms-variants[-env]  image variant jobs (src/lib/variants)
                      queue  al-ummah-now-cms-feed[-env]      home timeline builds → KV FEED ──► www (docs/FEED.md)
                      queue  al-ummah-now-cms-ai[-dlq][-env]  AI assist jobs (src/lib/ai)
                      bindings: DB (D1), MEDIA (R2), FEED (KV), VARIANTS + FEED_JOBS + AI_JOBS (Queues; AI with a DLQ), CF_VERSION_METADATA, AI (Workers AI)
```

## Pieces

| File | Role |
|---|---|
| `src/schema.ts` | Content model (bknd code mode). Single source of truth; `migrations/` must match it. |
| `src/bknd-config.ts` | bknd module config: roles (guest: nothing, admin: all, editor: content CRUD minus delete, writer: create/update posts and media only), auth (password off), media (R2), CORS pinned to own origin. Merged onto bknd defaults. |
| `src/app.ts` | Builds the bknd app once per isolate. `syncSchema: false` — bknd never alters D1. |
| `src/routes/sso.ts`, `src/lib/oidc.ts` | SSO: state + PKCE in a signed `__Host-cms_sso` cookie, token exchange, JWKS verification (`jose`), role mapping, user upsert, bknd session via `authenticator.jwt` + `getAuthCookieHeader`. See "Signed in everywhere" below. |
| `src/lib/roles.ts` | Auth role → bknd role: Super Admin / Admin → `admin`, Moderator → `editor`, Scholar → `writer` (own posts only, `docs/SCHOLARS.md`); strongest role wins, anything else is 403. |
| `src/lib/scholars/access.ts` | The staff screens and endpoints a `writer` may open (posts, their own scholar profile, AI assist, the picker, preview of their posts); everything else is 403. Ownership of a single post is checked per route. |
| `src/admin/` | The staff admin (it replaced bknd's admin UI, CMS#22/#30): `routes.tsx` screens and session-gated paths, `screens/*` server-rendered pages, `client/*` browser behaviour (`shell.ts` holds the session watcher), `*-api.ts` the `/admin/api/*` endpoints, `legacy.ts` redirects from bknd's old admin URLs. |
| `src/lib/accounts.ts` | Account chooser on /sso/no-access and /sso/accounts (also linked from the admin's account menu). |
| `src/lib/content-rules.ts` | bknd plugin: timestamps, `published_at` on first publish, URL/slug/tag validation. |
| `src/routes/public-api.ts` | `docs/PUBLIC_API.md`. Every query has `status = 'published'`. ETag + `s-maxage=60`. |
| `src/routes/preview.ts`, `src/lib/preview.ts` | Draft preview on www: signed, 30-minute, one-row tokens (HMAC key derived from `BKND_JWT_SECRET`), minted by staff only; the preview API serves the public Page/Post shape, `no-store`. `docs/PUBLIC_API.md` "Preview API". |
| `src/lib/blocks.ts` | Page blocks and card-post slides: types, limits, validation (`normalizeBlocks`/`normalizeSlides`), body derivation, text extraction for translation. Imports nothing: shared by the Worker and the admin client. |
| `src/lib/blocks-public.ts` | Resolves blocks and slides for the public API at read time (media → MediaRef, picked posts → live summaries in the page's locale, videos → snapshots); drops incomplete or non-public blocks. |
| `src/lib/video-snapshots.ts` | Snapshots of videos used in blocks and their D1 refresh queue (cron): backoff, dead-letter, compare-and-set, Overview flag + Retry. |
| `src/admin/screens/blocks.tsx`, `src/admin/client/blocks.ts` | Block and slide editors: server-rendered items and templates, client-side ordered lists (buttons, Alt+↑/↓, drag, Undo), media and posts choosers, preview. |
| `src/lib/feed/`, `src/admin/screens/timeline.tsx`, `src/admin/timeline-api.ts` | www's home timeline (docs/FEED.md): what is on it (`source.ts`), the KV layout and reader (`model.ts`), the coalesced queued build, verifier and DLQ flag (`jobs.ts`), the post plugin, the Timeline screen and its API (`admin.ts`). |
| `src/routes/picker.ts`, `src/lib/videos.ts`, `src/lib/embeds.ts` | Picker page (en/ar), videos-API proxy that drops non-public items, embed URL adapter. |
| `src/lib/security.ts`, `src/lib/paths.ts` | CSP with per-response nonce, no-store/noindex, CSRF Origin check, blocked bknd routes, retired bknd admin paths (`isRetiredBkndAdminPath`), upload policy (jpeg/png/webp/avif ≤ 10 MB). |
| `src/lib/variants/` | Image variants (CMS-10, docs/PUBLIC_API.md "Image variants"): `plan.ts` widths/formats/R2 keys, `jobs.ts` queue consumer + D1 `media_variants` state + cron sweep, `codecs.ts` WASM codecs (fresh instance per call, decode read in place), `resize.ts` streaming area resize, `png.ts`, `probe.ts` header size + EXIF orientation. |
| `src/lib/ai/*`, `src/admin/ai-api.ts`, `src/admin/ui/ai.tsx`, `src/admin/client/ai.ts` | AI writing assist (`docs/AI_ASSIST_SPEC.md`): translate en↔ar, SEO copy, pre-publish checks as queued, deduped, rate-limited jobs; usage log for the cost dashboard. Providers are pluggable (`src/lib/ai/providers/*`: Workers AI + one generic HTTP adapter configured as data on `/ai-settings`, `docs/AI_PROVIDERS.md`), with a fallback and a monthly budget stop. |
| `scripts/` | Schema check, migration guard, wrangler config check, secrets manifest/check, release (promote/smoke/rollback). |

## bknd specifics worth knowing (0.21.0)

- Code mode with `isProduction: true` skips config validation **and default filling**, so our config
  is merged onto `getDefaultConfig()`.
- A plugin listener's *returned* data is validated, and a JSON field that is absent from the payload
  is "invalid", so the return is silently dropped (bknd's own timestamps plugin does nothing on
  entities with JSON fields). `content-rules.ts` mutates `event.params.data` in place instead.
- An enum's `default_value` is not applied before the required check → the plugin defaults `status`.
- The default CORS reflects any origin with credentials → pinned to the CMS origin.
- The session cookie is named `auth` by bknd; it is Secure, HttpOnly, SameSite=Lax, Path=/, 8 h.
- bknd's admin UI is not served (CMS#30): `/bknd/*` goes to `/`, and its old `/data/*`, `/media/*`,
  `/auth/users`, `/settings` … URLs redirect to the matching staff screen (`src/admin/legacy.ts`).
  The staff screens talk to bknd only through its API (`/api/*`) and the Worker's `/admin/api/*`.

## Signed in everywhere (SSO behaviour)

- `/sso/login` sends **no `prompt`**: auth signs the browser's active account in silently, or shows
  its form when there is no browser session. Only `?prompt=login` (add account) and `?prompt=none`
  (silent re-auth after a switch) are forwarded; nothing else.
- An error on the callback after `prompt=none` (e.g. `login_required`) falls back to the normal
  sign-in (no prompt), so there is no error page and no loop. Other errors show "Sign-in failed".
- Auth tokens are not kept after the callback: the CMS needs the identity and roles once; the
  picker calls the public videos API server-side without a user token. So nothing is refreshed.
  When the 8 h bknd session ends, the gate (full page loads) or the staff screens' session watcher
  (`src/admin/client/shell.ts`: `/api/auth/me` on focus, on becoming visible and every 5 min) sends
  the browser to `/sso/login`, which is silent while auth has a browser session.
- Account chooser (`/sso/no-access`, `/sso/accounts`, linked from the picker and the admin's account menu): the
  browser reads `GET {AUTH}/session/accounts` (credentialed; auth's CORS must allow the CMS origin,
  and these pages' CSP allows `connect-src` to the auth origin). Switch = `POST /session/switch` then
  `/sso/login?prompt=none`; sign out of one account = `DELETE /session/accounts/:id` then a silent
  sign-in; the last account = `/sso/logout` (single sign-out). A switch to an account without a CMS
  role also clears the CMS session held for the previous account.
- After single sign-out, auth has no browser session, so the next CMS visit shows auth's sign-in form.
- bknd reads the `auth` cookie itself, so `/api/*` forwards a cookie the Worker refused (a session
  ended by a sign-out) without it: bknd answers as for a guest.

## Staff passkeys (wiki AUTH-PASSKEYS)

`src/lib/passkeys.ts` applies the consumer rule at `/sso/callback`. Auth's access token carries
`amr` (top level), `auth_time` and, for staff while enforcement is on, `properties.passkey_deadline`
(epoch seconds). Staff = any Auth role Super Admin, Admin, Moderator, Writer, Content Reviewer or
Senior Reviewer (Scholar and Member are not staff). For staff with a deadline whose `amr` lacks
`passkey` (no `amr` = no passkey):

- **Deadline passed:** no CMS session and no user row; 303 to `/sso/passkey-needed` (200, en/ar,
  Light/Dark). **Add a passkey** → `{AUTH}/passkeys/setup?return_to={CMS}/sso/login?prompt=login…`;
  **Sign in with a passkey** → `/sso/login?prompt=login`. Both come back through a fresh sign-in,
  because silent single sign-on keeps the original `amr`.
- **Grace (deadline ahead):** a normal session whose JWT also holds `pkd` (the deadline), and the
  admin shows the banner "Add a passkey by <date>". From `pkd` on, the gate sends screens to the
  page and APIs (`/admin/api`, `/picker/api`, `/api`) answer `403 { error: "passkey_required",
  setup_url }`; the session watcher follows that to the page. The 8 h session never outlives it.
