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
                      ├─ /picker, /picker/api/*       video picker → videos.api.alummahnow.net (server-side)
                      ├─ /, /data/*, /media/*, …      bknd admin UI   ┐ session required
                      └─ /api/*                       bknd API        ┘ guard on, same-origin mutations
                      queue  al-ummah-now-cms-variants[-env]  image variant jobs (src/lib/variants)
                      bindings: DB (D1), MEDIA (R2), VARIANTS (Queue), CF_VERSION_METADATA
```

## Pieces

| File | Role |
|---|---|
| `src/schema.ts` | Content model (bknd code mode). Single source of truth; `migrations/` must match it. |
| `src/bknd-config.ts` | bknd module config: roles (guest: nothing, admin: all, editor: content CRUD minus delete), auth (password off), media (R2), CORS pinned to own origin. Merged onto bknd defaults. |
| `src/app.ts` | Builds the bknd app once per isolate. `syncSchema: false` — bknd never alters D1. |
| `src/routes/sso.ts`, `src/lib/oidc.ts` | SSO: state + PKCE in a signed `__Host-cms_sso` cookie, token exchange, JWKS verification (`jose`), role mapping, user upsert, bknd session via `authenticator.jwt` + `getAuthCookieHeader`. See "Signed in everywhere" below. |
| `src/lib/accounts.ts`, `src/lib/admin-ui.ts` | Account chooser on /sso/no-access and /sso/accounts; links + session watcher injected into bknd's admin UI. |
| `src/lib/content-rules.ts` | bknd plugin: timestamps, `published_at` on first publish, URL/slug/tag validation. |
| `src/routes/public-api.ts` | `docs/PUBLIC_API.md`. Every query has `status = 'published'`. ETag + `s-maxage=60`. |
| `src/routes/preview.ts`, `src/lib/preview.ts` | Draft preview on www: signed, 30-minute, one-row tokens (HMAC key derived from `BKND_JWT_SECRET`), minted by staff only; the preview API serves the public Page/Post shape, `no-store`. `docs/PUBLIC_API.md` "Preview API". |
| `src/routes/picker.ts`, `src/lib/videos.ts`, `src/lib/embeds.ts` | Picker page (en/ar), videos-API proxy that drops non-public items, embed URL adapter. |
| `src/lib/security.ts`, `src/lib/paths.ts` | CSP with per-response nonce, no-store/noindex, CSRF Origin check, blocked bknd routes, upload policy (jpeg/png/webp/avif ≤ 10 MB). |
| `src/lib/variants/` | Image variants (CMS-10, docs/PUBLIC_API.md "Image variants"): `plan.ts` widths/formats/R2 keys, `jobs.ts` queue consumer + D1 `media_variants` state + cron sweep, `codecs.ts` WASM codecs (fresh instance per call, decode read in place), `resize.ts` streaming area resize, `png.ts`, `probe.ts` header size + EXIF orientation. |
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
- The admin UI has no custom menu links in code mode (bknd's `userMenu` option exists only when
  the admin is bundled from source); the wrapper injects fixed "Accounts" and "Video picker" links
  into the admin HTML (HTMLRewriter), which also adds the CSP nonce to bknd's inline script.

## Signed in everywhere (SSO behaviour)

- `/sso/login` sends **no `prompt`**: auth signs the browser's active account in silently, or shows
  its form when there is no browser session. Only `?prompt=login` (add account) and `?prompt=none`
  (silent re-auth after a switch) are forwarded; nothing else.
- An error on the callback after `prompt=none` (e.g. `login_required`) falls back to the normal
  sign-in (no prompt), so there is no error page and no loop. Other errors show "Sign-in failed".
- Auth tokens are not kept after the callback: the CMS needs the identity and roles once; the
  picker calls the public videos API server-side without a user token. So nothing is refreshed.
  When the 8 h bknd session ends, the gate (full page loads) or the injected session watcher (open
  admin SPA: focus / every 5 min, or a client-side hop to bknd's /auth/login) sends the browser to
  `/sso/login`, which is silent while auth has a browser session.
- Account chooser (`/sso/no-access`, `/sso/accounts`, linked from the picker and the admin UI): the
  browser reads `GET {AUTH}/session/accounts` (credentialed; auth's CORS must allow the CMS origin,
  and these pages' CSP allows `connect-src` to the auth origin). Switch = `POST /session/switch` then
  `/sso/login?prompt=none`; sign out of one account = `DELETE /session/accounts/:id` then a silent
  sign-in; the last account = `/sso/logout` (single sign-out). A switch to an account without a CMS
  role also clears the CMS session held for the previous account.
- After single sign-out, auth has no browser session, so the next CMS visit shows auth's sign-in form.
