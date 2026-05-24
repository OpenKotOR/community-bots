#!/usr/bin/env bash
# Drain catalog reindex queue into Chroma via Crawl4AI (trask-indexer).
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
  echo "trask_indexer_drain_queue: allowlist missing — run: node scripts/export_trask_allowlist_catalog.mjs" >&2
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

EXTRA=()
if [[ "${1:-}" == "--dry-run" ]]; then
  EXTRA=(--dry-run)
  shift
fi

echo "▶ Drain reindex queue (INGEST_STATE_DIR=$INGEST_STATE_DIR) into Chroma…"
"$PYTHON" -m trask_indexer.cli drain-queue "${EXTRA[@]}" "$@"
