#!/usr/bin/env bash
# Scheduled Chroma backup: create archive, optional off-site upload, prune old local copies.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export TRASK_INDEXER_DATA_DIR="${TRASK_INDEXER_DATA_DIR:-data/trask-indexer}"
OUTPUT_DIR="${TRASK_CHROMA_BACKUP_DIR:-data/trask-indexer/backups}"
RETAIN="${TRASK_CHROMA_BACKUP_RETAIN:-7}"
UPLOAD_CMD="${TRASK_CHROMA_BACKUP_UPLOAD_CMD:-}"

DRY_RUN=0
BACKUP_ARGS=()
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      BACKUP_ARGS+=(--dry-run)
      shift
      ;;
    --output-dir)
      OUTPUT_DIR="${2:?missing path after --output-dir}"
      BACKUP_ARGS+=(--output-dir "$OUTPUT_DIR")
      shift 2
      ;;
    *)
      echo "trask_chroma_backup_scheduled: unknown flag: $1" >&2
      exit 1
      ;;
  esac
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  bash scripts/trask_chroma_backup.sh "${BACKUP_ARGS[@]}"
  echo "dry-run: would retain newest ${RETAIN} archive(s) in ${OUTPUT_DIR}"
  if [[ -n "$UPLOAD_CMD" ]]; then
    echo "dry-run: would run TRASK_CHROMA_BACKUP_UPLOAD_CMD after backup"
  fi
  exit 0
fi

mkdir -p "$OUTPUT_DIR"
BEFORE_COUNT="$(find "$OUTPUT_DIR" -maxdepth 1 -name 'trask-chroma-*.tar.gz' 2>/dev/null | wc -l | tr -d ' ')"

bash scripts/trask_chroma_backup.sh "${BACKUP_ARGS[@]}"

LATEST="$(find "$OUTPUT_DIR" -maxdepth 1 -name 'trask-chroma-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null \
  | sort -rn | head -1 | cut -d' ' -f2-)"
if [[ -z "$LATEST" ]]; then
  echo "trask_chroma_backup_scheduled: no archive found after backup" >&2
  exit 1
fi

if [[ -n "$UPLOAD_CMD" ]]; then
  echo "▶ Uploading ${LATEST}"
  ARCHIVE="$LATEST" bash -c "$UPLOAD_CMD"
  echo "✓ Upload complete"
fi

if [[ "$RETAIN" =~ ^[0-9]+$ ]] && [[ "$RETAIN" -gt 0 ]]; then
  mapfile -t OLD_ARCHIVES < <(
    find "$OUTPUT_DIR" -maxdepth 1 -name 'trask-chroma-*.tar.gz' -printf '%T@ %p\n' 2>/dev/null \
      | sort -rn | tail -n +$((RETAIN + 1)) | cut -d' ' -f2-
  )
  for archive in "${OLD_ARCHIVES[@]:-}"; do
    [[ -z "$archive" ]] && continue
    echo "▶ Pruning old backup: $archive"
    rm -f "$archive"
  done
fi

AFTER_COUNT="$(find "$OUTPUT_DIR" -maxdepth 1 -name 'trask-chroma-*.tar.gz' 2>/dev/null | wc -l | tr -d ' ')"
echo "✓ Scheduled backup done (${BEFORE_COUNT} → ${AFTER_COUNT} local archive(s), retain=${RETAIN})"
