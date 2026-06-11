---
title: Holocron Trask HTTP
emoji: 📚
colorFrom: indigo
colorTo: blue
sdk: docker
app_port: 7860
startup_duration_timeout: 1h
---

# Holocron Trask HTTP (Hugging Face Space)

Public `trask-http-server` with **in-container Crawl4AI indexer** (`trask-indexer serve` on :8790), local ingest chunks, and `/api/trask/*` for Holocron.

The Docker image runs a **supervisor entrypoint** that starts the indexer, waits for `/health`, then starts `trask-http-server`. Build time seeds Chroma with golden QA fixtures (`trask_index_seed_for_qa.sh`).

## Deploy

- Workflow: `.github/workflows/trask-http-public.yml`
- Space: `OpenKotOR/holocron-trask-http`
- Secret: `HUGGINGFACE_TOKEN` (repository secret)

## Runtime

| Variable | Purpose |
|----------|---------|
| `TRASK_WEB_RESEARCH_PYTHON` | `.venv-trask-research` from Docker build |
| `TRASK_INDEXER_BASE_URL` | In-container retrieve API (`http://127.0.0.1:8790`; indexer started by entrypoint) |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | Optional answer rewrite |
| `TRASK_RESEARCH_TIMEOUT_MS` | Research subprocess timeout (default 900000) |

## Public outage recovery

When `trask-worker` `/healthz` reports `upstreamReachable: false` and the Space shows **ERROR** or **CONFIG_ERROR** on Hugging Face:

1. Confirm Space `README.md` frontmatter includes `sdk: docker` and `app_port: 7860` (`pnpm trask:verify-hf-pack`).
2. Redeploy: `gh workflow run trask-http-public.yml` (needs `HUGGINGFACE_TOKEN`).
3. Verify worker upstream: `TRASK_API_BASE=https://trask-worker.bocloud.workers.dev pnpm trask:public-api:check`
4. Verify Pages client: `pnpm holocron:public-gate` (Playwright on `qa-webui` + API preflight).

Worker `TRASK_RESEARCHWIZARD_BASE_URL` must point at this Space (`https://openkotor-holocron-trask-http.hf.space` or custom domain).
