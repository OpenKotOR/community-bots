---
title: Holocron Trask HTTP
---

# Holocron Trask HTTP (Hugging Face Space)

Public `trask-http-server` with **Crawl4AI indexer retrieval** (`scripts/trask_web_research.py`), local ingest chunks, and `/api/trask/*` for Holocron.

## Deploy

- Workflow: `.github/workflows/trask-http-public.yml`
- Space: `OpenKotOR/holocron-trask-http`
- Secret: `HUGGINGFACE_TOKEN` (repository secret)

## Runtime

| Variable | Purpose |
|----------|---------|
| `TRASK_WEB_RESEARCH_PYTHON` | `.venv-trask-research` from Docker build |
| `TRASK_INDEXER_BASE_URL` | Retrieve API (default in image: `http://127.0.0.1:8790`) |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | Optional answer rewrite |
| `TRASK_RESEARCH_TIMEOUT_MS` | Research subprocess timeout (default 900000) |
