---
title: OpenKotOR Holocron Trask API
emoji: 📚
colorFrom: gray
colorTo: red
sdk: docker
app_port: 7860
pinned: false
---

# Holocron Trask API (public fallback)

Bundled technical-reference Trask API for the static Holocron `qa-webui` on GitHub Pages. Source of truth lives in this monorepo under `infra/holocron-trask-api/`; CI deploys it to the Hugging Face Space `OpenKotOR/holocron-trask-api` (`.github/workflows/holocron-trask-api.yml`).

The same fallback logic is also embedded in `infra/trask-worker` when `TRASK_BUILTIN_API=1`, so production can use the Cloudflare Worker alone (`TRASK_API_BASE` → worker URL) without depending on a manual HF upload.

## Local run

```bash
node infra/holocron-trask-api/server.mjs
# http://127.0.0.1:7860/healthz
```

## Endpoints

- `GET /healthz` — liveness (`mode: fallback-public-api`)
- `GET /reference`, `GET /reference/:slug` — bundled reference pages (HTTPS source URLs)
- `GET|POST /api/trask/*` — Holocron browser contract (`session`, `ask`, `thread`, `history`, …)

`POST /api/trask/ask` returns `201` with `status: complete` and grounded sources for the five canonical Holocron e2e topics.
