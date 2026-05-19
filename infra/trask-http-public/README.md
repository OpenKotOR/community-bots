---
title: Holocron Trask HTTP (GPTR)
emoji: 🔮
colorFrom: blue
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
---

# Holocron Trask HTTP

Public `trask-http-server` and `/api/trask/*` for Holocron. Docker image includes **Crawl4AI** research venv (`TRASK_WEB_RESEARCH_PYTHON`). Set `OPENAI_API_KEY` or `OPENROUTER_API_KEY` for live synthesis (`docs/trask-research-backends.md`).

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

Holocron research **requires at least one working LLM** in the provider fallback chain (`llm_fallbacks` free models when no paid keys are set). On startup, `trask-http-server` probes the chain and exposes `researchAvailable` on `GET /api/trask/session`. Set `TRASK_STRICT_LLM_PROBE=1` to refuse boot when every provider fails.
