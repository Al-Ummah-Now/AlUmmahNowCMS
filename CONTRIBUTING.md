# Contributing

- Work from `main`; open a PR. CI must pass (lint, typecheck, tests, schema check, migration guard,
  config check, dry-run bundles).
- Every change carries tests. Data-model changes ship as a new expand-only migration in the same PR
  (see README "Changing the content model").
- Never commit secrets or `.dev.vars`. A new secret goes into `scripts/secrets-manifest.ts` in the
  same PR that starts reading it.
- Production only via `release.yml` (stage first). Rollback via `rollback.yml`.
