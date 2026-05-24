#!/usr/bin/env bash
# Long-running worker: poll INGEST_STATE_DIR reindex queue and drain into Chroma.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export INGEST_STATE_DIR="${INGEST_STATE_DIR:-data/ingest-worker}"
export TRASK_INDEXER_DATA_DIR="${TRASK_INDEXER_DATA_DIR:-data/trask-indexer}"

for envfile in ".env" ".env.local"; do
  if [[ -f "$envfile" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a
  fi
done

if [[ ! -f "$ROOT/data/trask-indexer/allowlist.json" ]]; then
  echo "trask_indexer_run_queue_worker: allowlist missing — run: node scripts/export_trask_allowlist_catalog.mjs" >&2
  exit 1
fi

PYTHON="${TRASK_WEB_RESEARCH_PYTHON:-}"
if [[ -z "$PYTHON" && -x "$ROOT/.venv-trask-indexer/bin/python" ]]; then
  PYTHON="$ROOT/.venv-trask-indexer/bin/python"
fi
if [[ -z "$PYTHON" && -x "$ROOT/.venv-trask-research/bin/python" ]]; then
  PYTHON="$ROOT/.venv-trask-research/bin/python"
fi
PYTHON="${PYTHON:-python3}"

POLL_MS="${1:-}"

echo "▶ Trask indexer queue worker (INGEST_STATE_DIR=$INGEST_STATE_DIR poll_ms=${POLL_MS:-15000})…"
if [[ -n "$POLL_MS" ]]; then
  exec "$PYTHON" -m trask_indexer.cli run-queue-worker "$POLL_MS"
else
  exec "$PYTHON" -m trask_indexer.cli run-queue-worker
fi
