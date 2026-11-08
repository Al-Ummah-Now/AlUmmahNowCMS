# Architecture

```
browser (staff) ──► cms.alummahnow.net  (Worker al-ummah-now-cms)
                      │  src/index.ts — Hono wrapper
                      ├─ /healthz                     liveness (+ ?deep=1: config, D1, version id)
                      ├─ /api/public/v1/*             public read API (D1 SQL, published rows only) ◄── www (service binding CMS)
                      ├─ /sso/login|callback|logout   PKCE → auth.alummahnow.net, bknd session cookie
                      ├─ /picker, /picker/api/*       video picker → videos.api.alummahnow.net (server-side)
                      ├─ /, /data/*, /media/*, …      bknd admin UI   ┐ session required
                      └─ /api/*                       bknd API        ┘ guard on, same-origin mutations
                      bindings: DB (D1), MEDIA (R2), CF_VERSION_METADATA
```

## Pieces

| File | Role |
|---|---|
| `src/schema.ts` | Content model (bknd code mode). Single source of truth; `migrations/` must match it. |
| `src/bknd-config.ts` | bknd module config: roles (guest: nothing, admin: all, editor: content CRUD minus delete), auth (password off), media (R2), CORS pinned to own origin. Merged onto bknd defaults. |
| `src/app.ts` | Builds the bknd app once per isolate. `syncSchema: false` — bknd never alters D1. |
| `src/routes/sso.ts`, `src/lib/oidc.ts` | SSO: state + PKCE in a signed `__Host-cms_sso` cookie, token exchange, JWKS verification (`jose`), role mapping, user upsert, bknd session via `authenticator.jwt` + `getAuthCookieHeader`. |
| `src/lib/content-rules.ts` | bknd plugin: timestamps, `published_at` on first publish, URL/slug/tag validation. |
| `src/routes/public-api.ts` | `docs/PUBLIC_API.md`. Every query has `status = 'published'`. ETag + `s-maxage=60`. |
| `src/routes/picker.ts`, `src/lib/videos.ts`, `src/lib/embeds.ts` | Picker page (en/ar), videos-API proxy that drops non-public items, embed URL adapter. |
| `src/lib/security.ts`, `src/lib/paths.ts` | CSP with per-response nonce, no-store/noindex, CSRF Origin check, blocked bknd routes, upload policy (jpeg/png/webp/avif ≤ 10 MB). |
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
- The admin UI has no custom menu links in code mode; the wrapper injects a fixed "Video picker"
  link into the admin HTML (HTMLRewriter), which also adds the CSP nonce to bknd's inline script.
