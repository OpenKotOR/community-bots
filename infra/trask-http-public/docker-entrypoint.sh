#!/usr/bin/env bash
# Start trask-indexer (Chroma retrieve) then trask-http-server in one HF/public container.
set -euo pipefail

ROOT="/workspace"
cd "$ROOT"

INDEXER_PORT="${TRASK_INDEXER_PORT:-8790}"
INDEXER_HOST="${TRASK_INDEXER_HOST:-127.0.0.1}"
INDEXER_BIN="${TRASK_INDEXER_BIN:-${ROOT}/.venv-trask-indexer/bin/trask-indexer}"
export TRASK_INDEXER_DATA_DIR="${TRASK_INDEXER_DATA_DIR:-${ROOT}/data/trask-indexer}"
export TRASK_INDEXER_BASE_URL="${TRASK_INDEXER_BASE_URL:-http://${INDEXER_HOST}:${INDEXER_PORT}}"

INDEXER_PID=""

cleanup() {
  if [[ -n "${INDEXER_PID}" ]] && kill -0 "${INDEXER_PID}" 2>/dev/null; then
    kill "${INDEXER_PID}" 2>/dev/null || true
    wait "${INDEXER_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [[ ! -x "${INDEXER_BIN}" ]]; then
  echo "docker-entrypoint: missing indexer CLI at ${INDEXER_BIN}" >&2
  exit 1
fi

echo "docker-entrypoint: starting trask-indexer on ${TRASK_INDEXER_BASE_URL}…"
"${INDEXER_BIN}" serve --host "${INDEXER_HOST}" --port "${INDEXER_PORT}" &
INDEXER_PID=$!

for _ in $(seq 1 90); do
  if curl -sf "http://${INDEXER_HOST}:${INDEXER_PORT}/health" >/dev/null; then
    echo "docker-entrypoint: indexer healthy"
    break
  fi
  if ! kill -0 "${INDEXER_PID}" 2>/dev/null; then
    echo "docker-entrypoint: indexer exited before health check" >&2
    exit 1
  fi
  sleep 1
done

if ! curl -sf "http://${INDEXER_HOST}:${INDEXER_PORT}/health" >/dev/null; then
  echo "docker-entrypoint: indexer health check timed out" >&2
  exit 1
fi

echo "docker-entrypoint: starting trask-http-server on port ${PORT:-7860}…"
exec node apps/trask-http-server/dist/main.js
