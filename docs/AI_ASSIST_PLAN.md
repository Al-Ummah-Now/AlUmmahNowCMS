# AI writing assist — delivery plan

**Spec:** `docs/AI_ASSIST_SPEC.md`. **Issue:** #17. One PR (spec, plan and implementation), merged with
`--rebase --admin` once CI is green; QA follows main. No release tag from this PR.

## Cloudflare resources (done before the PR, owner rule: wrangler only)

| Env | Queue | DLQ |
|---|---|---|
| prod | `al-ummah-now-cms-ai` | `al-ummah-now-cms-ai-dlq` |
| stage | `al-ummah-now-cms-ai-stage` | `al-ummah-now-cms-ai-dlq-stage` |
| QA | `al-ummah-now-cms-ai-qa` | `al-ummah-now-cms-ai-dlq-qa` |

Created 2026-11-10 with `wrangler queues create`. No Anthropic key exists in any env (Secrets Store
and Worker secrets checked by name); the feature ships in its "not set up" state until one is added
(spec §2).

## Tasks

| # | Task | Files | Tests |
|---|---|---|---|
| A1 | Migration `0006_ai_assist.sql` (`ai_jobs`, `ai_usage`, indexes) | `migrations/` | schema check, migration guard |
| A2 | Queue bindings + consumers per env; config check knows them; promote registers consumers for stage/prod (`versions upload` doesn't) | `wrangler.jsonc`, `scripts/check-wrangler-config.ts`, `scripts/release/envs.ts`, `scripts/release/queue-consumers.ts`, `scripts/release/promote.ts` | config check unit, consumer-plan unit |
| A3 | Optional secret `ANTHROPIC_API_KEY` in the manifest; check-secrets reports optional ones | `scripts/secrets-manifest.ts`, `scripts/check-secrets.ts` | unit |
| A4 | `src/lib/ai/*`: key resolution, client factory (SDK, injectable `fetch`), prompts + policy (epic 28 copy), chunking, invariants, pricing, validators, rate limit, jobs store, runner | `src/lib/ai/` | node unit |
| A5 | Endpoints `/admin/api/ai/{status,jobs,jobs/:id,usage,failures/:id/dismiss}` | `src/admin/ai-api.ts`, `src/admin/routes.tsx` | worker tests (role matrix, 503, 413, 429, dedupe) |
| A6 | Queue + DLQ consumers in the Worker's `queue` handler; 30-day cleanup in the cron | `src/index.ts`, `src/lib/ai/runner.ts` | worker tests with a mocked client (success, resume, retry, permanent, DLQ, usage rows) |
| A7 | UI: AI assist card, SEO suggest, check dialog, translation review dialog, `?ai=` fill, admin "not set up" card, Overview failure card; strings en/ar | `src/admin/screens/content.tsx`, `src/admin/screens/overview.tsx`, `src/admin/ui/*`, `src/admin/client/ai.ts`, `src/admin/i18n.ts` | worker render tests; E2E |
| A8 | Local E2E harness: mock auth issuer + mock Anthropic API, `wrangler dev` with `ENVIRONMENT=local`; CI job `e2e-local` | `e2e/local/*`, `playwright.local.config.ts`, `.github/workflows/ci.yml` | Playwright (Chromium desktop + phone): 4 flows × en/ar × light/dark, axe |
| A9 | QA E2E: admin sees "not set up", moderator sees nothing | `e2e/ai-assist.spec.ts` | Playwright vs QA |
| A10 | Docs: ARCHITECTURE, README env/secrets notes | docs | — |

## Follow-ups (queue issues)

- AlUmmahNow: cost monitor reads the CMS AI usage rollup (vendor `anthropic`).
- CMS: monthly AI budget with a hard stop (after #266 budgets).
- Owner: add `anthropic-api-key` to the Secrets Store and the bindings, QA first (then the QA E2E
  smoke for real calls).
