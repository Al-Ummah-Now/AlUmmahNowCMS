#!/usr/bin/env bash
# Local CMS for the AI assist E2E (docs/AI_ASSIST_SPEC.md §9): `wrangler dev` (local D1, R2 and
# queues) against e2e/local/mock-server.ts for auth and the Claude API. No Cloudflare account, no
# real key: the "key" is a placeholder the mock accepts.
#   e2e/local/cms.sh on|off <port>     on = AI assist configured, off = no key
set -euo pipefail
cd "$(dirname "$0")/../.."
mode=$1
port=$2
mock="http://127.0.0.1:${MOCK_PORT:-8798}"
dir=".e2e-local/$mode"
rm -rf "$dir"
mkdir -p "$dir"
{
  echo "ENVIRONMENT=local"
  echo "PUBLIC_URL=http://localhost:$port"
  echo "AUTH_ISSUER=$mock"
  echo "AUTH_CLIENT_ID=e2e-local"
  echo "VIDEOS_API_URL=$mock"
  echo "VIDEOS_WEB_URL=$mock"
  echo "ADMIN_API_URL=$mock"
  echo "ADMIN_WEB_URL=$mock"
  echo "WWW_URL=http://localhost:4321"
  echo "WWW_ORIGINS=http://localhost:4321"
  if [ "$mode" = on ]; then
    echo "ANTHROPIC_API_KEY=mock-key-not-real"
    echo "ANTHROPIC_BASE_URL=$mock"
  fi
} > "$dir/vars.env"
CI=true npx wrangler d1 migrations apply DB --local --env="" --persist-to "$dir/state" >/dev/null
exec npx wrangler dev --env="" --port "$port" --ip localhost --inspector-port "$((port + 700))" \
  --persist-to "$dir/state" --env-file "$dir/vars.env" --show-interactive-dev-session=false
