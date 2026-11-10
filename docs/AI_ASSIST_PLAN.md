# AI writing assist — delivery plan

**Spec:** `docs/AI_ASSIST_SPEC.md`. **Issue:** #17. One PR (spec, plan and implementation), merged with
`--rebase --admin` once CI is green; QA follows main. No release tag from this PR.

## Cloudflare resources (done before the PR, owner rule: wrangler only)

| Env | Queue | DLQ |
|---|---|---|
| prod | `al-ummah-now-cms-ai` | `al-ummah-now-cms-ai-dlq` |
| stage | `al-ummah-now-cms-ai-stage` | `al-ummah-now-cms-ai-dlq-stage` |
| QA | `al-ummah-now-cms-ai-qa` | `al-ummah-now-cms-ai-dlq-qa` |

Created 2026-11-10 with `wrangler queues create`. The model is Workers AI through the `AI` binding,
declared in every env of `wrangler.jsonc` (spec §2): no secret, so the feature is on in each env as
soon as a deploy carries the binding.

## Tasks

| # | Task | Files | Tests |
|---|---|---|---|
| A1 | Migration `0008_ai_assist.sql` (`ai_jobs`, `ai_usage`, indexes) | `migrations/` | schema check, migration guard |
| A2 | Queue bindings + consumers per env; config check knows them; promote registers consumers for stage/prod (`versions upload` doesn't) | `wrangler.jsonc`, `scripts/check-wrangler-config.ts`, `scripts/release/envs.ts`, `scripts/release/queue-consumers.ts`, `scripts/release/promote.ts` | config check unit, consumer-plan unit |
| A3 | `ai` binding in every env (config check requires it); `ANTHROPIC_API_KEY` forbidden in the secrets manifest | `wrangler.jsonc`, `scripts/check-wrangler-config.ts`, `scripts/secrets-manifest.ts` | unit |
| A4 | `src/lib/ai/*`: binding resolution (+ local mock), Workers AI client (JSON schema, reasoning level, timeout, error codes), prompts + policy (epic 28 copy), chunking, invariants, Neuron pricing, validators, rate limit, jobs store, runner | `src/lib/ai/` | node unit |
| A5 | Endpoints `/admin/api/ai/{status,jobs,jobs/:id,usage,failures/:id/dismiss}` | `src/admin/ai-api.ts`, `src/admin/routes.tsx` | worker tests (role matrix, 503, 413, 429, dedupe) |
| A6 | Queue + DLQ consumers in the Worker's `queue` handler; 30-day cleanup in the cron | `src/index.ts`, `src/lib/ai/runner.ts` | worker tests with a mocked client (success, resume, retry, permanent, DLQ, usage rows) |
| A7 | UI: AI assist card, SEO suggest, check dialog, translation review dialog, `?ai=` fill, admin "not set up" card, Overview failure card; strings en/ar | `src/admin/screens/content.tsx`, `src/admin/screens/overview.tsx`, `src/admin/ui/*`, `src/admin/client/ai.ts`, `src/admin/i18n.ts` | worker render tests; E2E |
| A8 | Local E2E harness: mock auth issuer + mock Workers AI, `wrangler dev` with `ENVIRONMENT=local` and a config without the `AI` binding (`e2e/local/wrangler-config.ts`); CI job `e2e-local` | `e2e/local/*`, `playwright.local.config.ts`, `.github/workflows/ci.yml` | Playwright (Chromium desktop + phone): 4 flows × en/ar × light/dark, axe |
| A9 | QA E2E: both roles get the controls when the binding is there; "not set up" for admins otherwise | `e2e/ai-assist.spec.ts` | Playwright vs QA |
| A11 | Move from the Claude API to Workers AI (owner, 2026-11-10): models chosen on real en/ar samples (spec §1.5), Neurons in `ai_usage` (migration `0009_ai_usage_neurons.sql`), SDK removed | `src/lib/ai/*`, `migrations/`, `test/support/workers-ai-mock.ts` | unit, worker, local E2E, real runs on Workers AI |
| A10 | Docs: ARCHITECTURE, README env/secrets notes | docs | — |

## Follow-ups (queue issues)

- AlUmmahNow: cost monitor reads the CMS AI usage rollup (vendor `cloudflare-workers-ai`) to attribute the CMS share of the account's Workers AI bill.
- CMS: monthly AI budget with a hard stop (after #266 budgets).
- Re-check the model choice when Workers AI adds or deprecates models (`wrangler ai models list`); the evaluation in spec §1.5 is the bar.
