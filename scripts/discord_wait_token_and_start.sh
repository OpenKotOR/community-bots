#!/usr/bin/env bash
# After Developer Portal token reset + MFA, capture token from .env or clipboard and start bot.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"
LOG=/tmp/trask-bot.log

looks_like_bot_token() {
  local t="$1"
  [[ ${#t} -gt 50 ]] && [[ "$t" == *.* ]] && [[ "$t" =~ ^[A-Za-z0-9._-]+$ ]]
}

read_clipboard() {
  if command -v xclip >/dev/null 2>&1; then
    xclip -selection clipboard -o 2>/dev/null | tr -d '\r\n' || true
  elif command -v wl-paste >/dev/null 2>&1; then
    wl-paste -n 2>/dev/null || true
  fi
}

set_token() {
  local tok="$1"
  if grep -q '^TRASK_DISCORD_BOT_TOKEN=' "$ENV_FILE"; then
    sed -i "s|^TRASK_DISCORD_BOT_TOKEN=.*|TRASK_DISCORD_BOT_TOKEN=${tok}|" "$ENV_FILE"
  else
    printf '\nTRASK_DISCORD_BOT_TOKEN=%s\n' "$tok" >>"$ENV_FILE"
  fi
}

for ((i = 0; i < 300; i++)); do
  tok=$(grep '^TRASK_DISCORD_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '[:space:]')
  if looks_like_bot_token "$tok"; then
    echo "Token already in .env"
    cd "$ROOT" && bash scripts/trask_bot_start.sh >>"$LOG" 2>&1 &
    sleep 4
    tail -25 "$LOG"
    exit 0
  fi
  clip=$(read_clipboard)
  if looks_like_bot_token "$clip"; then
    echo "Token from clipboard → .env"
    set_token "$clip"
    cd "$ROOT" && bash scripts/trask_bot_start.sh >>"$LOG" 2>&1 &
    sleep 4
    tail -25 "$LOG"
    exit 0
  fi
  sleep 2
done

echo "Timed out waiting for bot token (5 min). Complete MFA, copy token, or run: bash scripts/trask_env_set_token.sh" >&2
exit 1
