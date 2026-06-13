# Trask retrieve Worker (Wrangler)

Edge `POST /retrieve` for Trask RAG. **Phase 1** proxies to the existing Chroma indexer (`trask-indexer serve` on port 8790). Chroma does not run inside Workers; public deploys default to the Hugging Face Trask HTTP Space, which exposes `POST /retrieve` and proxies to its in-container indexer. Use a persistent indexer host or migrate to **Vectorize + D1** later when needed.

## Local dev

```bash
# Terminal A — Chroma indexer
bash scripts/bootstrap_trask_indexer.sh
cd infra/trask-indexer && trask-indexer serve

# Terminal B — Worker (defaults TRASK_INDEXER_BASE_URL=http://127.0.0.1:8790)
cd infra/trask-retrieve-worker
pnpm install
pnpm dev
```

```bash
curl -sS http://127.0.0.1:8787/health
curl -sS -X POST http://127.0.0.1:8787/retrieve \
  -H 'Content-Type: application/json' \
  -d '{"query":"What is TSLPatcher used for in KOTOR modding?","limit":6}'
```

Point bots and Holocron at the Worker with `TRASK_INDEXER_BASE_URL=https://trask-retrieve.<account>.workers.dev` once deployed.
The Worker bounds upstream indexer calls with `TRASK_RETRIEVE_UPSTREAM_TIMEOUT_MS` (default `5000`) and returns a JSON `503` or `504` instead of letting user-facing surfaces hang. The timeout has a built-in default; setting the variable is only an override.

## VPS co-located (wrangler dev proxy)

When Chroma indexer runs on the same host, run the Worker locally on `:8787` so clients match the CI/local stack contract:

```bash
bash scripts/trask_retrieve_worker_start.sh
pnpm trask:stack:health
```

systemd: `infra/trask-retrieve-worker/systemd/trask-retrieve-worker.service.example` (requires `trask-indexer.service`).

Set holocron/bot `TRASK_INDEXER_BASE_URL=http://127.0.0.1:8787`.
Optionally set `TRASK_RETRIEVE_UPSTREAM_TIMEOUT_MS` in the Worker environment if the co-located indexer needs a different fail-fast budget.

## Deploy (Cloudflare edge)

```bash
pnpm dlx wrangler deploy --config infra/trask-retrieve-worker/wrangler.toml
pnpm dlx wrangler secret put TRASK_INDEXER_BASE_URL --config infra/trask-retrieve-worker/wrangler.toml
```

Keep `TRASK_RETRIEVE_UPSTREAM_TIMEOUT_MS` low enough for Discord defers and Holocron polling to degrade honestly inside the global research budget.

## Future (Vectorize)

Replace the proxy body with Workers AI embeddings + Vectorize query + D1 passage lookup. Keep the same `/retrieve` JSON contract so `scripts/trask_web_research.py` and `@openkotor/trask` stay unchanged.
