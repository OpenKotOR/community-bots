#!/usr/bin/env bash
# Start trask-http-server with Holocron dist for Playwright live e2e (no API mocks).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export TRASK_WEB_ALLOW_ANONYMOUS="${TRASK_WEB_ALLOW_ANONYMOUS:-1}"
export TRASK_HTTP_PORT="${TRASK_HTTP_PORT:-4010}"

for envfile in ".env" ".env.local" "vendor/ai-researchwizard/.env"; do
  if [[ -f "$envfile" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a
  fi
done

DIST="$ROOT/apps/holocron-web/dist"
if [[ ! -f "$DIST/index.html" ]]; then
  echo "holocron-e2e-live-server: missing $DIST — run holocron build first" >&2
  exit 1
fi

SERVER="$ROOT/apps/trask-http-server/dist/main.js"
if [[ ! -f "$SERVER" ]]; then
  echo "holocron-e2e-live-server: missing $SERVER — run workspace build first" >&2
  exit 1
fi

exec node "$SERVER"
