#!/usr/bin/env bash
# CI: load FastEmbed BGE model once (respects FASTEMBED_CACHE_PATH). Retries on HF 429.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

export FASTEMBED_CACHE_PATH="${FASTEMBED_CACHE_PATH:-$REPO_ROOT/.cache/fastembed}"
mkdir -p "$FASTEMBED_CACHE_PATH"

PY="${PY:-$REPO_ROOT/.venv-trask-indexer/bin/python}"

warmup() {
  "$PY" -c "from trask_indexer.embed import embed_texts; embed_texts(['ci warmup']); print('embed ok')"
}

if find "$FASTEMBED_CACHE_PATH" -type f -print -quit 2>/dev/null | grep -q .; then
  echo "FastEmbed cache dir has files at $FASTEMBED_CACHE_PATH; probing..."
  if warmup; then
    echo "Embedding model ready from cache"
    exit 0
  fi
  echo "Cache probe failed; will retry download with backoff"
fi

max_attempts="${TRASK_CI_EMBED_WARMUP_ATTEMPTS:-8}"
for attempt in $(seq 1 "$max_attempts"); do
  if warmup; then
    echo "Embedding model ready (attempt $attempt)"
    exit 0
  fi
  if [ "$attempt" -ge "$max_attempts" ]; then
    echo "Embedding warmup failed after $max_attempts attempts" >&2
    exit 1
  fi
  wait=$((45 * attempt))
  echo "warmup attempt $attempt failed; sleep ${wait}s"
  sleep "$wait"
done
