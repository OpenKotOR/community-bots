#!/usr/bin/env bash
# Archive Trask Chroma persistence directory for backup/disaster recovery.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export TRASK_INDEXER_DATA_DIR="${TRASK_INDEXER_DATA_DIR:-data/trask-indexer}"
CHROMA_DIR="${TRASK_INDEXER_DATA_DIR}/chroma"
OUTPUT_DIR="${TRASK_CHROMA_BACKUP_DIR:-data/trask-indexer/backups}"

DRY_RUN=0
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --output-dir)
      OUTPUT_DIR="${2:?missing path after --output-dir}"
      shift 2
      ;;
    *)
      echo "trask_chroma_backup: unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "$CHROMA_DIR" ]]; then
  echo "trask_chroma_backup: chroma dir missing: $CHROMA_DIR" >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ARCHIVE="${OUTPUT_DIR}/trask-chroma-${STAMP}.tar.gz"
PARENT="$(dirname "$CHROMA_DIR")"
BASE="$(basename "$CHROMA_DIR")"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "dry-run: would create $ARCHIVE from $CHROMA_DIR"
  exit 0
fi

echo "▶ Backing up $CHROMA_DIR → $ARCHIVE"
tar -czf "$ARCHIVE" -C "$PARENT" "$BASE"
echo "✓ Wrote $ARCHIVE ($(du -h "$ARCHIVE" | awk '{print $1}'))"
