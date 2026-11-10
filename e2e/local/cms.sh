#!/usr/bin/env bash
# Local CMS for the AI assist E2E (docs/AI_ASSIST_SPEC.md §9): `wrangler dev` (local D1, R2 and
# queues) against e2e/local/mock-server.ts for auth and Workers AI. No Cloudflare account: the config
# drops the remote `AI` binding (e2e/local/wrangler-config.ts) and "on" points AI_MOCK_URL at the mock.
#   e2e/local/cms.sh on|off <port>     on = AI assist configured, off = no model binding
set -euo pipefail
cd "$(dirname "$0")/../.."
mode=$1
port=$2
mock="http://127.0.0.1:${MOCK_PORT:-8798}"
dir="$PWD/.e2e-local/$mode" # absolute: wrangler resolves paths against the config file's folder
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
    echo "AI_MOCK_URL=$mock"
    # A fake key for the generic HTTP provider test (e2e/local/mock-server.ts E2E_AI_KEY); not a credential.
    echo "AI_KEY_E2E=e2e-local-fake-key" # secret-scan:allow
  fi
} > "$dir/vars.env"
node --experimental-strip-types --no-warnings e2e/local/wrangler-config.ts "$dir/wrangler.json"
CI=true npx wrangler d1 migrations apply DB --local -c "$dir/wrangler.json" --persist-to "$dir/state" >/dev/null
exec npx wrangler dev -c "$dir/wrangler.json" --port "$port" --ip localhost --inspector-port "$((port + 700))" \
  --persist-to "$dir/state" --env-file "$dir/vars.env" --show-interactive-dev-session=false
