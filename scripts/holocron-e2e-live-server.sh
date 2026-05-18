#!/usr/bin/env bash
# Start trask-http-server with Holocron dist for Playwright live e2e (no API mocks).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export TRASK_WEB_ALLOW_ANONYMOUS="${TRASK_WEB_ALLOW_ANONYMOUS:-1}"
export TRASK_HTTP_PORT="${TRASK_HTTP_PORT:-4010}"
export TRASK_RESEARCHWIZARD_TIMEOUT_MS="${TRASK_RESEARCHWIZARD_TIMEOUT_MS:-900000}"

for envfile in ".env" ".env.local" "vendor/ai-researchwizard/.env"; do
  if [[ -f "$envfile" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a
  fi
done

has_llm=0
for key in OPENAI_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY GOOGLE_API_KEY GROQ_API_KEY ANTHROPIC_API_KEY; do
  if [[ -n "${!key:-}" ]]; then
    has_llm=1
    break
  fi
done
if [[ "$has_llm" -eq 0 ]]; then
  echo "holocron-e2e-live-server: warning — no LLM API keys in .env / .env.local / vendor/ai-researchwizard/.env." >&2
  echo "  Holocron will use DuckDuckGo retriever-only research (slower, lower quality). Add OPENROUTER_API_KEY for best results." >&2
fi

DIST="$ROOT/apps/holocron-web/dist"
if [[ ! -f "$DIST/index.html" ]]; then
  echo "holocron-e2e-live-server: missing $DIST — run holocron build first" >&2
  exit 1
fi

SERVER="$ROOT/apps/trask-http-server/dist/main.js"
if [[ ! -f "$SERVER" ]]; then
  echo "holocron-e2e-live-server: missing $SERVER — run workspace build first" >&2
  exit 1
fi

exec node "$SERVER"
