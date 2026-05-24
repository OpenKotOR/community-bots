#!/usr/bin/env bash
# Start Trask retrieve Worker locally (wrangler dev proxy to Chroma indexer).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

INDEXER_PORT="${TRASK_INDEXER_PORT:-8790}"
WORKER_PORT="${TRASK_RETRIEVE_WORKER_PORT:-8787}"
INDEXER_BASE="${TRASK_INDEXER_BASE_URL:-http://127.0.0.1:${INDEXER_PORT}}"

for envfile in ".env" ".env.local"; do
  if [[ -f "$ROOT/$envfile" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$ROOT/$envfile"
    set +a
  fi
done

if ! curl -sf "${INDEXER_BASE%/}/health" >/dev/null 2>&1; then
  echo "trask_retrieve_worker_start: indexer not reachable at ${INDEXER_BASE}" >&2
  echo "Start trask-indexer first (systemd or trask-indexer serve)." >&2
  exit 1
fi

cd "$ROOT/infra/trask-retrieve-worker"
if [[ ! -d node_modules ]]; then
  pnpm install
fi

echo "▶ Retrieve Worker on :${WORKER_PORT} → ${INDEXER_BASE}"
exec env TRASK_INDEXER_BASE_URL="$INDEXER_BASE" \
  pnpm exec wrangler dev --port "$WORKER_PORT" --local-protocol http
