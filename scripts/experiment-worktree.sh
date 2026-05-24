#!/usr/bin/env bash
# Minimal experiment worktree helper for ce-optimize serial runs.
set -euo pipefail

ACTION="${1:?action: create|cleanup|count}"
SPEC_NAME="${2:-}"
EXP_INDEX="${3:-001}"
BASE_BRANCH="${4:-main}"
shift 4 || true
SHARED_FILES=("$@")

ROOT="$(git rev-parse --show-toplevel)"
WORKTREE_ROOT="$ROOT/.context/compound-engineering/ce-optimize-worktrees"
BRANCH="optimize-exp/${SPEC_NAME}/exp-${EXP_INDEX}"
PATH_DIR="$WORKTREE_ROOT/${SPEC_NAME}/exp-${EXP_INDEX}"

case "$ACTION" in
  create)
    mkdir -p "$WORKTREE_ROOT/${SPEC_NAME}"
    if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
      git branch -D "$BRANCH" >/dev/null 2>&1 || true
    fi
    if [ -d "$PATH_DIR" ]; then
      git worktree remove --force "$PATH_DIR" >/dev/null 2>&1 || rm -rf "$PATH_DIR"
    fi
    git worktree add -b "$BRANCH" "$PATH_DIR" "$BASE_BRANCH" >/dev/null
    for rel in "${SHARED_FILES[@]}"; do
      if [ -n "$rel" ] && [ -f "$ROOT/$rel" ]; then
        mkdir -p "$(dirname "$PATH_DIR/$rel")"
        cp "$ROOT/$rel" "$PATH_DIR/$rel"
      fi
    done
    echo "$PATH_DIR"
    ;;
  cleanup)
    if [ -d "$PATH_DIR" ]; then
      git worktree remove --force "$PATH_DIR" >/dev/null 2>&1 || rm -rf "$PATH_DIR"
    fi
    git branch -D "$BRANCH" >/dev/null 2>&1 || true
    ;;
  count)
    find "$WORKTREE_ROOT" -mindepth 2 -maxdepth 2 -type d 2>/dev/null | wc -l | tr -d ' '
    ;;
  *)
    echo "unknown action: $ACTION" >&2
    exit 2
    ;;
esac
