#!/usr/bin/env bash
# Restore Trask Chroma from a backup tarball. Stop the indexer before running.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export TRASK_INDEXER_DATA_DIR="${TRASK_INDEXER_DATA_DIR:-data/trask-indexer}"
CHROMA_DIR="${TRASK_INDEXER_DATA_DIR}/chroma"
INDEXER_PORT="${TRASK_INDEXER_PORT:-8790}"

ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" || ! -f "$ARCHIVE" ]]; then
  echo "usage: $0 <trask-chroma-backup.tar.gz>" >&2
  exit 1
fi

if curl -sf "http://127.0.0.1:${INDEXER_PORT}/health" >/dev/null 2>&1; then
  echo "trask_chroma_restore: indexer appears to be running on :${INDEXER_PORT}" >&2
  echo "Stop the indexer (e.g. fuser -k ${INDEXER_PORT}/tcp) before restore." >&2
  exit 1
fi

PARENT="$(dirname "$CHROMA_DIR")"
BASE="$(basename "$CHROMA_DIR")"
QUARANTINE=""

if [[ -d "$CHROMA_DIR" ]]; then
  QUARANTINE="${CHROMA_DIR}.pre-restore.$(date -u +%Y%m%dT%H%M%SZ)"
  echo "▶ Moving existing chroma to $QUARANTINE"
  mv "$CHROMA_DIR" "$QUARANTINE"
fi

mkdir -p "$PARENT"
echo "▶ Restoring from $ARCHIVE into $PARENT"
tar -xzf "$ARCHIVE" -C "$PARENT"
if [[ ! -d "$CHROMA_DIR" ]]; then
  echo "trask_chroma_restore: archive did not contain $BASE/ — check tarball layout" >&2
  if [[ -n "$QUARANTINE" ]]; then
    mv "$QUARANTINE" "$CHROMA_DIR"
  fi
  exit 1
fi

echo "✓ Restored $CHROMA_DIR"
if [[ -n "$QUARANTINE" ]]; then
  echo "Previous data kept at: $QUARANTINE"
fi
