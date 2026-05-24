#!/usr/bin/env bash
# Start Chroma indexer + retrieve Worker for Holocron Playwright e2e when not already healthy.
# Does not start trask-http (Playwright webServer owns :4010).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

INDEXER_PORT="${TRASK_INDEXER_PORT:-8790}"
WORKER_PORT="${TRASK_RETRIEVE_WORKER_PORT:-8787}"
INDEXER_URL="http://127.0.0.1:${INDEXER_PORT}"
WORKER_URL="http://127.0.0.1:${WORKER_PORT}"

export TRASK_INDEXER_BASE_URL="${TRASK_INDEXER_BASE_URL:-$WORKER_URL}"
export TRASK_INDEXER_DATA_DIR="${TRASK_INDEXER_DATA_DIR:-$ROOT/data/trask-indexer}"

if curl -sf "${WORKER_URL}/health" >/dev/null 2>&1 && curl -sf "${INDEXER_URL}/health" >/dev/null 2>&1; then
  echo "ensure_trask_indexed_stack_for_e2e: indexer + Worker already healthy"
  exit 0
fi

if [[ "${HOLOCRON_E2E_SKIP_STACK_BOOTSTRAP:-}" == "1" ]]; then
  echo "ensure_trask_indexed_stack_for_e2e: HOLOCRON_E2E_SKIP_STACK_BOOTSTRAP=1 and stack unhealthy" >&2
  exit 1
fi

echo "ensure_trask_indexed_stack_for_e2e: starting indexer + retrieve Worker for e2e…"

if [[ ! -d "$ROOT/data/trask-indexer/chroma" ]]; then
  bash scripts/bootstrap_trask_indexer.sh
  bash scripts/trask_index_seed_for_qa.sh
fi

INDEXER_BIN="${ROOT}/.venv-trask-indexer/bin/trask-indexer"
if [[ ! -x "$INDEXER_BIN" ]]; then
  bash scripts/bootstrap_trask_indexer.sh
fi

if ! curl -sf "${INDEXER_URL}/health" >/dev/null 2>&1; then
  echo "ensure_trask_indexed_stack_for_e2e: starting indexer on :${INDEXER_PORT}…"
  (
    TRASK_INDEXER_DATA_DIR="$ROOT/data/trask-indexer" \
      "$INDEXER_BIN" serve --host 127.0.0.1 --port "$INDEXER_PORT"
  ) &
  for _ in $(seq 1 60); do
    if curl -sf "${INDEXER_URL}/health" >/dev/null; then
      break
    fi
    sleep 0.5
  done
fi

if ! curl -sf "${INDEXER_URL}/health" >/dev/null 2>&1; then
  echo "ensure_trask_indexed_stack_for_e2e: indexer failed to become healthy at ${INDEXER_URL}" >&2
  exit 1
fi

if ! curl -sf "${WORKER_URL}/health" >/dev/null 2>&1; then
  echo "ensure_trask_indexed_stack_for_e2e: starting retrieve Worker on :${WORKER_PORT}…"
  (
    cd "$ROOT/infra/trask-retrieve-worker"
    TRASK_INDEXER_BASE_URL="${INDEXER_URL}" \
      pnpm exec wrangler dev --port "$WORKER_PORT" --local-protocol http
  ) &
  for _ in $(seq 1 60); do
    if curl -sf "${WORKER_URL}/health" >/dev/null; then
      break
    fi
    sleep 0.5
  done
fi

if ! curl -sf "${WORKER_URL}/health" >/dev/null 2>&1; then
  echo "ensure_trask_indexed_stack_for_e2e: retrieve Worker failed at ${WORKER_URL}" >&2
  exit 1
fi

echo "ensure_trask_indexed_stack_for_e2e: ready (${WORKER_URL} → indexer ${INDEXER_URL})"
