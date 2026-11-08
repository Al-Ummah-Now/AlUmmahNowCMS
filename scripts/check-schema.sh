#!/usr/bin/env bash
# Schema check (SPEC §8): the code model (src/schema.ts) must equal the migrations.
#   1. apply migrations/*.sql to a fresh local D1 (wrangler, same engine as production)
#   2. `bknd sync --sql` against that database must output NO statements.
# Run: npm run check:schema
set -euo pipefail
cd "$(dirname "$0")/.."

work=.schema-check
rm -rf "$work/d1" "$work/drift.sql"
mkdir -p "$work"

CI=true npx wrangler d1 migrations apply DB --local --persist-to "$work/d1" >/dev/null
db=$(find "$work/d1" -name '*.sqlite' -not -name 'metadata.sqlite' | head -n 1)
if [ -z "$db" ]; then
  echo "check-schema: could not find the local D1 database" >&2
  exit 2
fi

DB_URL="file:$db" npx bknd sync --sql --out "$work/drift.sql" >/dev/null 2>"$work/sync.log" || {
  cat "$work/sync.log" >&2
  exit 2
}

if [ -s "$work/drift.sql" ]; then
  echo "check-schema: src/schema.ts and migrations/ differ. Add an expand-only migration with:" >&2
  echo "" >&2
  cat "$work/drift.sql" >&2
  echo "" >&2
  echo "(generate it with: npm run db:diff)" >&2
  exit 1
fi
echo "check-schema: OK (migrations == src/schema.ts)"
