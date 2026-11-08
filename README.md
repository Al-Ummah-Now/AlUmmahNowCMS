# AlUmmahNowCMS — cms.alummahnow.net

The staff-only content admin for **www.alummahnow.net**. A Cloudflare Worker running
[bknd](https://bknd.io) 0.21 in **code mode** (schema from `src/schema.ts`, never edited in the UI),
wrapped by a small Hono app that adds SSO, a public read API for www, and a video picker.

- Spec: [`docs/SPEC.md`](docs/SPEC.md) · Plan: [`docs/PLAN.md`](docs/PLAN.md) ·
  Public API contract: [`docs/PUBLIC_API.md`](docs/PUBLIC_API.md) · [`ARCHITECTURE.md`](ARCHITECTURE.md)

| Env | URL | Worker | D1 | R2 |
|---|---|---|---|---|
| prod | https://cms.alummahnow.net | `al-ummah-now-cms` | `al-ummah-now-cms` | `al-ummah-now-cms` |
| stage | https://cms.stage.alummahnow.net | `al-ummah-now-cms-stage` | `al-ummah-now-cms-stage` | `al-ummah-now-cms-stage` |
| QA | https://cms.qa.alummahnow.net | `al-ummah-now-cms-qa` | `al-ummah-now-cms-qa` | `al-ummah-now-cms-qa` |

## Access

SSO only, through auth.alummahnow.net (public PKCE client, no client secret). Roles from the
access token: **Super Admin / Admin → bknd `admin`**, **Moderator → bknd `editor`** (create/edit/
publish content, upload images; no deletes, no settings). Everyone else gets a 403 page. bknd's own
password login and registration are disabled.

## Develop

```bash
npm ci
cp .dev.vars.example .dev.vars        # local vars (QA auth issuer; no secrets needed locally)
npm run db:migrate:local              # apply migrations/ to the local D1
npm run dev                           # http://localhost:8585
```

Signing in locally needs the QA auth client to allow `http://localhost:8585/sso/callback` (it does).

```bash
npm run lint && npm run typecheck && npm test   # unit + Workers-runtime tests (miniflare D1/R2)
npm run check:schema                            # migrations == src/schema.ts
npm run check:migrations                        # expand-only, append-only vs origin/main
npm run check:config                            # wrangler.jsonc matches the env table
CMS_URL=http://localhost:8585 npm run e2e       # Playwright (signed-in tests need QA_SEED_PASSWORD)
```

## Changing the content model

1. Edit `src/schema.ts` (add only — never remove or rename a field; stop reading it instead).
2. `npm run check:schema` prints the SQL bknd wants; save it as the next `migrations/NNNN_name.sql`.
3. CI rejects drift, destructive SQL, and edits to merged migrations. bknd never changes the schema
   at runtime; deploys run `wrangler d1 migrations apply`.

## Deploy

- **QA:** every push to `main` → `deploy-qa.yml` (migrate QA D1, deploy, smoke, secrets check, E2E).
- **Production:** push a tag `vYYYY.MM.DD` (`vYYYY.MM.DD.N`, N ≥ 2, for a later release that day) on a
  commit on `main` → `release.yml`: resolve (valid tag on `main`?) → build once → stage (migrate, 0 % +
  override smoke, 100 %, E2E) → production (tag still on that commit?, migrate, 0 % smoke, 100 %,
  auto-rollback) → rollback dry run. Merging to `main` deploys QA only.
- **Stage only:** run `release.yml` by hand on `main` (workflow_dispatch); it never touches production.
- Never move a tag; to retry, re-run that tag's run, or cut `vYYYY.MM.DD.N`. Manual rollback: `rollback.yml`.
- First release of a new Worker: its secrets check fails until the Worker exists. Create it once (an
  owner-approved bootstrap), set its secrets, then release through the tag.

### Secrets

| Where | Name | Notes |
|---|---|---|
| Worker (each env) | `BKND_JWT_SECRET` | `openssl rand -hex 32` → `wrangler secret put BKND_JWT_SECRET [--env qa\|stage]`. Required; the Worker serves 503 without it. |
| GitHub | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | Workers, D1 and R2 edit on account `0e4b6e7f…` |
| GitHub | `QA_SEED_PASSWORD`, `STAGE_SEED_PASSWORD` | E2E test accounts (`qa-admin`, `qa-moderator`, `qa-viewer`) |

Names live in `scripts/secrets-manifest.ts`; `scripts/check-secrets.ts` checks the deployed Workers.
