#!/usr/bin/env bash
# Assembles the local-stack bundle of this commit into dist/local-stack for AlUmmahNow's local E2E
# stack (AlUmmahNow scripts/local-stack): the prebuilt CMS Worker (bundles/cms), its wrangler config
# and every migration, at the same paths as in this repo, so the stack runs a released CMS without
# checking out or installing this repo. Needs `npm ci` done.
set -euo pipefail
OUT=dist/local-stack
rm -rf "$OUT" && mkdir -p "$OUT/bundles"
npx wrangler deploy --dry-run --env= --outdir "$OUT/bundles/cms" >/dev/null
cp wrangler.jsonc "$OUT/"
cp -R migrations "$OUT/"
printf '{"sha":"%s","built":"%s"}\n' "$(git rev-parse HEAD)" "$(date -u +%FT%TZ)" > "$OUT/local-stack.json"
echo "local-stack bundle: $(du -sh "$OUT" | cut -f1)"
