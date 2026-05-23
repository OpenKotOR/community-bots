#!/usr/bin/env bash
# Prepare Chroma + allowlist for Holocron/CLI Q&A verification (golden five queries).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export TRASK_INDEXER_DATA_DIR="${TRASK_INDEXER_DATA_DIR:-data/trask-indexer}"

for envfile in ".env" ".env.local"; do
  if [[ -f "$envfile" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a
  fi
done

if [[ ! -f packages/retrieval/dist/index.js ]]; then
  echo "trask_index_seed_for_qa: building workspace (retrieval package)…" >&2
  pnpm build
fi

echo "▶ Exporting allowlist catalog…"
node scripts/export_trask_allowlist_catalog.mjs

PYTHON="${TRASK_WEB_RESEARCH_PYTHON:-}"
if [[ -z "$PYTHON" && -x "$ROOT/.venv-trask-indexer/bin/python" ]]; then
  PYTHON="$ROOT/.venv-trask-indexer/bin/python"
fi
if [[ -z "$PYTHON" && -x "$ROOT/.venv-trask-research/bin/python" ]]; then
  PYTHON="$ROOT/.venv-trask-research/bin/python"
fi
PYTHON="${PYTHON:-python3}"

echo "▶ Seeding golden fixture corpus into Chroma…"
"$PYTHON" scripts/smoke_trask_indexed_stack.py --golden-fixtures --verify-retrieve

INDEXER_URL="${TRASK_INDEXER_BASE_URL:-http://127.0.0.1:8790}"
if curl -sf "${INDEXER_URL%/}/health" >/dev/null 2>&1; then
  echo "▶ Indexer health OK at $INDEXER_URL"
elif [[ "${TRASK_INDEX_SEED_REQUIRE_INDEXER:-0}" == "1" ]]; then
  echo "trask_index_seed_for_qa: indexer not reachable at $INDEXER_URL (start: trask-indexer serve)" >&2
  exit 1
else
  echo "▶ Indexer not running at $INDEXER_URL (local Chroma seeded; start trask-indexer serve for HTTP retrieve)" >&2
fi

echo "✅ QA index seed complete."
