# Trask retrieve Worker (Wrangler)

Edge `POST /retrieve` for Trask RAG. **Phase 1** proxies to the existing Chroma indexer (`trask-indexer serve` on port 8790). Chroma does not run inside Workers; use a persistent indexer host or migrate to **Vectorize + D1** later.

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

## Deploy

```bash
pnpm dlx wrangler deploy --config infra/trask-retrieve-worker/wrangler.toml
pnpm dlx wrangler secret put TRASK_INDEXER_BASE_URL --config infra/trask-retrieve-worker/wrangler.toml
```

## Future (Vectorize)

Replace the proxy body with Workers AI embeddings + Vectorize query + D1 passage lookup. Keep the same `/retrieve` JSON contract so `scripts/trask_web_research.py` and `@openkotor/trask` stay unchanged.
