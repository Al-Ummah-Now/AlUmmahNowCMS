# CMS + www delivery plan

**Spec:** `docs/SPEC.md` (this repo), AlUmmahNowUI `docs/SPEC.md`.
**Rules:** main only; every change carries CI tests; data changes ship as migrations plus a check;
prod only via stage-then-promote; out-of-scope work becomes `queue` issues.

## Cross-repo order

1. **Docs PRs** (this plan and the specs) in AlUmmahNowCMS and AlUmmahNowUI.
2. **AlUmmahNowAuth PR:** `0011_www_cms_clients.sql` (prod and QA dirs); `STAGE_HOSTS` gains `cms.` and
   `www.`, and the stage seed rewrites the seeded URIs of clients that aren't in prod yet; the profile
   launcher gains "Al Ummah Now (www)" (everyone) and "CMS" (super_admin, admin, moderator); the
   secrets manifest is unchanged (these Workers live in other repos). One auth PR at a time on the
   shared QA slot. Auth's `release.yml` takes it to stage and prod.
3. **Cloudflare resources** (owner rule: CF only): D1 `al-ummah-now-cms-qa` / `-stage`, R2 `-qa` / `-stage`,
   KV `al-ummah-now-www-snapshot{,-qa,-stage}`. Created with wrangler. Their ids go in the wrangler configs.
4. **CMS implementation PR** (this repo), then **www implementation PR** (AlUmmahNowUI). The www PR's
   E2E needs a QA CMS.
5. **Secrets:** `BKND_JWT_SECRET` (openssl) per CMS Worker (no `CMS_CLIENT_SECRET`: the CMS is a public
   PKCE client, SPEC §3); `SESSION_SECRET` per www Worker. GitHub: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `QA_SEED_PASSWORD`,
   `STAGE_SEED_PASSWORD` in both repos.
6. **QA** deploys on merge to main (`deploy-qa.yml`) → QA E2E.
7. **Release** (`release.yml`): stage → prod for both. www before CMS is fine (www falls back).
   Verify that the apex and www resolve over HTTPS.

## CMS tasks

| # | Task | Tests |
|---|---|---|
| C1 | bknd 0.21, code mode; `src/schema.ts` (§4); `src/index.ts` wrapper (Hono) around bknd's `serve` | typecheck |
| C2 | `migrations/0001_init.sql` generated from the schema (`bknd sync --sql` on an empty DB); `scripts/migration-guard.ts`; `scripts/check-schema.sh` | guard unit tests; schema check in CI |
| C3 | SSO: `/sso/login`, `/sso/callback`, `/sso/logout`, role mapping, user upsert, bknd session; password/register routes off; guard on, guest has no data perms | unit (jose local JWKS, mocked token endpoint) |
| C4 | Public API `/api/public/v1/*` (published-only), media proxy, cache headers, CORS | unit with in-memory D1 (miniflare/vitest-pool-workers) |
| C5 | Picker `/picker` + `/picker/api/*` proxy to the videos API; embeds adapter `src/lib/embeds.ts` | unit (non-public dropped) |
| C6 | 403/error pages en/ar, admin CSP and security headers | unit + axe in E2E |
| C7 | wrangler `env.qa`, `env.stage`, top level = prod; custom domains; `workers_dev: false` | `scripts/check-wrangler-config.ts` |
| C8 | CI `ci.yml` (lint, typecheck, unit, schema check, guard); `deploy-qa.yml`; `e2e-qa.yml`; `release.yml` + `scripts/release/*` (promote, smoke, rollback) + `rollback.yml` | release script unit tests |
| C9 | E2E: redirect to auth, non-admin denied, admin publishes → www shows it | Playwright |
| C10 | README/ARCHITECTURE/ROADMAP rewritten to match reality | — |

## www tasks (AlUmmahNowUI)

| # | Task | Tests |
|---|---|---|
| W1 | Remove the starter (blog, MDX, placeholder images, `utils/api.js`, the dev proxy to a dead `pages.dev`); Astro 5 latest + `@astrojs/cloudflare` + Tailwind 4; ESLint, `astro check` | lint/typecheck |
| W2 | i18n (en/ar), RTL layout, header/footer/landmarks, language switcher | i18n parity |
| W3 | CMS client: service binding, timeout, Cache API, KV snapshot, builtin fallback | fallback-chain unit |
| W4 | Pages: home, news list/article, CMS pages, videos, 404/500 | rendering unit, E2E |
| W5 | Embeds adapter + facade; markdown (HTML off, `::video`) | unit |
| W6 | Sign-in (PKCE public client), `/auth/me`, header menu, CMS link by role | unit |
| W7 | SEO: meta, hreflang, JSON-LD, sitemap, robots, RSS; noindex off prod | unit |
| W8 | Apex → www 301; security headers; HTML edge cache | unit |
| W9 | wrangler envs + custom domains (`www.` and apex on prod) | config check |
| W10 | CI/QA deploy/E2E/release the same as the CMS; axe + screenshots (desktop and mobile, en and ar) | Playwright |

## Release mechanics (both repos, modelled on AlUmmahNowAuth)

- `build` job: install, lint, typecheck, unit, `wrangler deploy --dry-run --outdir dist/<env>` per
  env (the Astro build is env-independent; env comes from vars), uploaded as an artifact.
- `stage` job: CMS migrate stage → `scripts/release/promote.ts --env stage` (upload version,
  0 % + override smoke, 100 %, smoke) → Playwright against stage.
- `production` job (environment `production`): a "still the head of main?" guard → migrate prod
  (expand-only) → promote prod with auto-rollback → summary + `release-result.json`.
- `rollback-dry-run` step: `scripts/release/rollback.ts --dry-run` resolves the previous version
  from `release-result.json` and prints the command without running it.
- `rollback.yml`: manual dispatch, rolls back to a given (or the previous) version.

## Out of scope → `queue` issues

Content Editor auth role; scheduled publishing; revisions/history; embedded discussions on www
(epic 26 consumer); "continue watching" on www; retire the `al-ummah-now-ui` and `bknd` Workers
and the stale docs; image resizing via CF Images; preview of drafts on www.
