# Trask indexer (Crawl4AI + FastEmbed + Chroma)

Self-hosted crawl, chunk, embed, and retrieve for Trask / Holocron. See `docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md`.

## Quick start (repo root)

```bash
pnpm --filter @openkotor/retrieval build
node scripts/export_trask_allowlist_catalog.mjs
bash scripts/bootstrap_trask_indexer.sh
source .venv-trask-indexer/bin/activate
python scripts/smoke_trask_indexed_stack.py
```

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRASK_INDEXER_DATA_DIR` | `data/trask-indexer` | Chroma persistence + allowlist JSON |
| `TRASK_EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | FastEmbed model id |
| `TRASK_CHROMA_COLLECTION` | `trask_dev` | Collection name |

## VPS roles (production)

- **Crawler VPS:** Chromium + Crawl4AI jobs
- **Index VPS:** FastEmbed + Chroma HTTP + `POST /retrieve`
- **API VPS:** `trask-http-server` with `TRASK_RESEARCH_BACKEND=indexed`
