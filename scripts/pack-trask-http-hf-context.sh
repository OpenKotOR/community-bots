#!/usr/bin/env bash
# Pack a minimal monorepo tree for Hugging Face Space Docker build (trask-http-public).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$(mktemp -d)}"

mkdir -p "$OUT/apps" "$OUT/infra/trask-http-public" "$OUT/vendor" "$OUT/data" "$OUT/scripts"

cp "$ROOT/infra/trask-http-public/Dockerfile" "$OUT/Dockerfile"
cp "$ROOT/infra/trask-http-public/README.md" "$OUT/README.md"
cp "$ROOT/infra/trask-http-public/docker-entrypoint.sh" "$OUT/infra/trask-http-public/docker-entrypoint.sh"

cp "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$ROOT/pnpm-workspace.yaml" "$ROOT/tsconfig.base.json" "$ROOT/tsconfig.workspace.json" "$OUT/"

rsync -a --exclude node_modules --exclude dist "$ROOT/packages/" "$OUT/packages/"
rsync -a --exclude node_modules --exclude dist "$ROOT/apps/trask-http-server/" "$OUT/apps/trask-http-server/"
rsync -a --exclude node_modules --exclude dist "$ROOT/apps/holocron-web/" "$OUT/apps/holocron-web/"
rsync -a --exclude node_modules --exclude dist --exclude .venv --exclude data/trask-indexer/chroma \
  "$ROOT/infra/trask-indexer/" "$OUT/infra/trask-indexer/"
rsync -a --exclude .git --exclude node_modules --exclude dist --exclude tests \
  "$ROOT/vendor/llm_fallbacks/" "$OUT/vendor/llm_fallbacks/"
rsync -a "$ROOT/data/ingest-worker/" "$OUT/data/ingest-worker/"
rsync -a "$ROOT/data/trask/" "$OUT/data/trask/"

for script in \
  bootstrap_trask_research.sh \
  bootstrap_trask_indexer.sh \
  trask_index_seed_for_qa.sh \
  smoke_trask_indexed_stack.py \
  export_trask_allowlist_catalog.mjs \
  trask_web_research.py
do
  cp "$ROOT/scripts/$script" "$OUT/scripts/$script"
done

echo "$OUT"
