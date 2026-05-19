#!/usr/bin/env bash
# Paste bot token into repo .env without editing the file by hand.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

if [[ $# -ge 1 ]]; then
  TOKEN="$1"
else
  read -r -s -p "TRASK_DISCORD_BOT_TOKEN: " TOKEN
  echo
fi

TOKEN="${TOKEN//[[:space:]]/}"
if [[ -z "$TOKEN" ]]; then
  echo "Token is empty." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

if grep -q '^TRASK_DISCORD_BOT_TOKEN=' "$ENV_FILE"; then
  sed -i "s|^TRASK_DISCORD_BOT_TOKEN=.*|TRASK_DISCORD_BOT_TOKEN=${TOKEN}|" "$ENV_FILE"
else
  printf '\nTRASK_DISCORD_BOT_TOKEN=%s\n' "$TOKEN" >>"$ENV_FILE"
fi

echo "Updated TRASK_DISCORD_BOT_TOKEN in $ENV_FILE ($(wc -c <<<"$TOKEN") bytes)."
