#!/usr/bin/env bash
# Start Trask Discord bot when repo-root .env has TRASK_DISCORD_BOT_TOKEN.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "Missing $ROOT/.env — run: node scripts/discord_fetch_trask_env.mjs" >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

if [[ -z "${TRASK_DISCORD_BOT_TOKEN:-}" ]]; then
  echo "TRASK_DISCORD_BOT_TOKEN is empty in .env." >&2
  echo "Developer Portal → Trask Q&A Assistant → Bot → Reset Token → copy token into .env" >&2
  exit 1
fi

pnpm build
exec node apps/trask-bot/dist/main.js
