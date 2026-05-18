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

## Space secrets (required for live research)

Set in the Space **Settings → Repository secrets** (CI syncs from GitHub when secrets exist):

- `OPENAI_API_KEY` and/or `OPENROUTER_API_KEY`
- Optional: `TAVILY_API_KEY` (web retrieval)

Without API keys, `/api/trask/ask` may return empty or fallback answers.
