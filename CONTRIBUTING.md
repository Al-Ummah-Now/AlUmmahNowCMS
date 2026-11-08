# Contributing

- Work from `main`; open a PR. CI must pass (lint, typecheck, tests, schema check, migration guard,
  config check, dry-run bundles).
- Every change carries tests. Data-model changes ship as a new expand-only migration in the same PR
  (see README "Changing the content model").
- Never commit secrets or `.dev.vars`. A new secret goes into `scripts/secrets-manifest.ts` in the
  same PR that starts reading it.
- Rollback via `rollback.yml`.

## Deploy rules

- Fix on `main`. QA follows `main` (`deploy-qa.yml` on every push).
- Production is released only by CI, only from `main`, and only from a release tag `vYYYY.MM.DD`
  (`vYYYY.MM.DD.N` for a later release that day) on a commit on `main`: stage → E2E → 0 % → 100 %,
  auto-rollback. A dispatched `release.yml` run on `main` is stage only.
- No hand deploys to stage or production (`wrangler deploy` / `versions deploy` from a laptop). If CI
  blocks a release, fix CI.
