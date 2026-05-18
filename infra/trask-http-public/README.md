---
title: Holocron Trask HTTP (GPTR)
emoji: 🔮
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Holocron Trask HTTP (live research)

Public `trask-http-server` with headless **ai-researchwizard** (GPTR), local ingest chunks, and `/api/trask/*` for Holocron.

- Source: `apps/trask-http-server` in [OpenKotOR/community-bots](https://github.com/OpenKotOR/community-bots)
- Deployed by `.github/workflows/trask-http-public.yml`
- Fronted for GitHub Pages by the Cloudflare worker (`TRASK_RESEARCHWIZARD_BASE_URL` when `TRASK_BUILTIN_API=0`)

## Space secrets (all optional)

CI syncs from GitHub repository secrets when they exist. None are required for deploy.

| Secret | Purpose |
|--------|---------|
| `OPENAI_API_KEY` | Optional OpenAI-compatible chat |
| `OPENROUTER_API_KEY` | Optional; also used when `OPENAI_API_KEY` is unset (see `loadSharedAiConfig`) |
| `TAVILY_API_KEY` | Optional web retrieval |
| `FAST_LLM` / `SMART_LLM` / `STRATEGIC_LLM` | Optional GPTR model overrides |

Without paid API keys, Trask uses **vendored `llm_fallbacks` free models** and **bundled local knowledge** (`data/ingest-worker`). Holocron still returns grounded answers for the canonical technical topics.
