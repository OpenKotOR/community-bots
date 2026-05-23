# Trask LiteLLM proxy

OpenAI-compatible gateway for Holocron / Trask rewrite and compose. **Free models first**, then paid fallbacks configured in `litellm_config.yaml`.

## Quick start

```bash
# From repo root — loads .env / .env.local
bash scripts/trask_litellm_proxy.sh
```

In another terminal (or `.env.local`):

```bash
LITELLM_PROXY_URL=http://127.0.0.1:4000
LITELLM_API_KEY=sk-local
TRASK_LLM_MODEL=trask-research
TRASK_LLM_PROFILE=free

# At least one provider key for the free chain:
OPENROUTER_API_KEY=sk-or-...
# Optional accelerators / paid fallbacks:
# GROQ_API_KEY=gsk_...
# OPENAI_API_KEY=sk-...
```

Then start the research stack:

```bash
pnpm build
bash scripts/trask_live_stack.sh
```

## Model aliases

| Alias | Role |
|-------|------|
| `trask-research` | Default free router (`openrouter/openrouter/free`) |
| `trask-research-llama-free` | Second free OpenRouter model |
| `trask-research-groq` | Groq free tier (needs `GROQ_API_KEY`) |
| `trask-research-paid` | OpenRouter auto (paid) |
| `trask-research-openai` | Direct `gpt-4o-mini` |
| `trask-research-paid-only` | Use with `TRASK_LLM_PROFILE=paid` |

Fallback order is defined under `litellm_settings.fallbacks` in `litellm_config.yaml`.

## Verify

```bash
curl -sf http://127.0.0.1:4000/health/liveliness

curl -s http://127.0.0.1:4000/v1/chat/completions \
  -H "Authorization: Bearer sk-local" \
  -H "Content-Type: application/json" \
  -d '{"model":"trask-research","messages":[{"role":"user","content":"Say hi in one word."}],"max_tokens":16}'
```

## Full catalog

The vendored [`vendor/llm_fallbacks`](../../vendor/llm_fallbacks) submodule ships larger generated configs (`configs/litellm_config_free.yaml`). Use those when you want dozens of OpenRouter `:free` models; this directory keeps a **minimal operator sample** aligned with `TRASK_LLM_MODEL=trask-research`.
