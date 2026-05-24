#!/usr/bin/env bash
# Crawl the full allowlisted golden corpus into Chroma for QA / production seeding.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export TRASK_INDEXER_DATA_DIR="${TRASK_INDEXER_DATA_DIR:-data/trask-indexer}"

LIMIT="${TRASK_GOLDEN_CORPUS_LIMIT:-}"
EXTRA=()
if [[ -n "$LIMIT" ]]; then
  EXTRA=(--limit "$LIMIT")
fi

if [[ "${1:-}" == "--dry-run" ]]; then
  exec bash scripts/trask_crawl_catalog.sh --dry-run "${EXTRA[@]}"
fi

echo "▶ Golden corpus crawl (all allowlist seeds; set TRASK_GOLDEN_CORPUS_LIMIT to cap)…"
exec bash scripts/trask_crawl_catalog.sh "${EXTRA[@]}" "$@"
