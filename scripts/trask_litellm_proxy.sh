#!/usr/bin/env bash
# Start LiteLLM proxy for Trask/Holocron (free-first, paid fallbacks).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${LITELLM_PORT:-4000}"
CONFIG="${TRASK_LITELLM_CONFIG:-$ROOT/infra/trask-litellm/litellm_config.yaml}"
# Full OpenRouter :free catalog (bolabaden/llm_fallbacks):
#   TRASK_LITELLM_CONFIG=$ROOT/vendor/llm_fallbacks/configs/litellm_config_free.yaml bash scripts/trask_litellm_proxy.sh

for envfile in ".env" ".env.local"; do
  if [[ -f "$envfile" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a
  fi
done

if [[ ! -f "$CONFIG" ]]; then
  echo "Missing LiteLLM config: $CONFIG" >&2
  exit 1
fi

if ! command -v litellm >/dev/null 2>&1; then
  echo "litellm CLI not found. Install one of:" >&2
  echo "  pip install 'litellm[proxy]'" >&2
  echo "  uv tool install 'litellm[proxy]'" >&2
  exit 1
fi

if [[ -z "${OPENROUTER_API_KEY:-}" && -z "${GROQ_API_KEY:-}" && -z "${OPENAI_API_KEY:-}" ]]; then
  echo "warning: no OPENROUTER_API_KEY, GROQ_API_KEY, or OPENAI_API_KEY — proxy will fail on first request." >&2
  echo "  Free default needs at least OPENROUTER_API_KEY (https://openrouter.ai)." >&2
fi

export LITELLM_MASTER_KEY="${LITELLM_MASTER_KEY:-sk-local}"

fuser -k "${PORT}/tcp" 2>/dev/null || true
sleep 0.5

echo "Starting LiteLLM on :${PORT} with ${CONFIG}"
echo "  Holocron: LITELLM_PROXY_URL=http://127.0.0.1:${PORT} LITELLM_API_KEY=sk-local TRASK_LLM_MODEL=trask-research"
exec litellm --config "$CONFIG" --port "$PORT" --host 127.0.0.1
