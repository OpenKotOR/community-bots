#!/usr/bin/env bash
# Post-scrape Trask Discord index sync with export-layout preflight.
# See docs/knowledgebase/50-execution/discordchat-exporter-trask-bridge-runbook.md

set -Eeuo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
REPO_ROOT="${DCE_REPO_ROOT:-$(cd "$SCRIPT_DIR/.." && pwd -P)}"
TARGETS_CONFIG="${TRASK_DISCORD_EXPORT_TARGETS_CONFIG:-$REPO_ROOT/data/trask/discord-export-targets.json}"
SYNC="$REPO_ROOT/scripts/trask_discord_sync.py"

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

has_trask_export_layout() {
  local dir=$1
  [[ -f "$dir/manifest.json" && -d "$dir/containers" ]]
}

preflight_targets() {
  command -v jq >/dev/null 2>&1 || {
    printf 'WARN: jq not found; skipping export layout preflight\n' >&2
    return 0
  }
  [[ -f "$TARGETS_CONFIG" ]] || die "Missing targets config: $TARGETS_CONFIG"

  local warnings=0
  while IFS= read -r row; do
    local name enabled output_dir
    name=$(jq -r '.name' <<<"$row")
    enabled=$(jq -r '.enabled' <<<"$row")
    output_dir=$(jq -r '.output_dir' <<<"$row")
    [[ "$enabled" == "true" ]] || continue
    [[ -n "$output_dir" && "$output_dir" != "null" ]] || continue
    if has_trask_export_layout "$output_dir"; then
      printf 'OK: %s → manifest layout at %s\n' "$name" "$output_dir"
    else
      printf 'WARN: %s enabled but %s lacks manifest.json + containers/ (DCE flat JSON is not indexed yet)\n' \
        "$name" "$output_dir" >&2
      warnings=$((warnings + 1))
    fi
  done < <(jq -c '.targets[]' "$TARGETS_CONFIG")

  if (( warnings > 0 )); then
    printf 'See docs/knowledgebase/50-execution/discordchat-exporter-trask-bridge-runbook.md § Format bridge\n' >&2
  fi
}

main() {
  [[ -x "$SYNC" || -f "$SYNC" ]] || die "Missing sync script: $SYNC"
  preflight_targets
  exec python3 "$SYNC" "$@"
}

main "$@"
