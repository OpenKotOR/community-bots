#!/usr/bin/env bash
# Pack a minimal monorepo tree for Hugging Face Space Docker build (trask-http-public).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$(mktemp -d)}"

mkdir -p "$OUT/apps" "$OUT/vendor" "$OUT/data" "$OUT/scripts"

cp "$ROOT/infra/trask-http-public/Dockerfile" "$OUT/Dockerfile"
cp "$ROOT/infra/trask-http-public/README.md" "$OUT/README.md"

cp "$ROOT/package.json" "$ROOT/pnpm-lock.yaml" "$ROOT/pnpm-workspace.yaml" "$ROOT/tsconfig.base.json" "$ROOT/tsconfig.workspace.json" "$OUT/"

rsync -a --exclude node_modules --exclude dist "$ROOT/packages/" "$OUT/packages/"
rsync -a --exclude node_modules --exclude dist "$ROOT/apps/trask-http-server/" "$OUT/apps/trask-http-server/"
rsync -a --exclude .git --exclude node_modules --exclude dist --exclude tests \
  "$ROOT/vendor/llm_fallbacks/" "$OUT/vendor/llm_fallbacks/"
rsync -a "$ROOT/data/ingest-worker/" "$OUT/data/ingest-worker/"
mkdir -p "$OUT/docs"
cp "$ROOT/docs/trask-research-backends.md" "$OUT/docs/trask-research-backends.md"

# Docker COPY expects these at repo root / scripts/ (see infra/trask-http-public/Dockerfile).
cp "$ROOT/requirements-trask-research.txt" "$OUT/requirements-trask-research.txt"
cp "$ROOT/scripts/trask_web_research.py" "$OUT/scripts/trask_web_research.py"

echo "$OUT"
