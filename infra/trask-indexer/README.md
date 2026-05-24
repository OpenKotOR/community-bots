# Trask indexer (Crawl4AI + FastEmbed + Chroma)

Self-hosted crawl, chunk, embed, and retrieve for Trask / Holocron. See `docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md` and `docs/knowledgebase/50-execution/trask-indexed-stack-runbook.md`.

## Quick start (repo root)

```bash
pnpm --filter @openkotor/retrieval build
node scripts/export_trask_allowlist_catalog.mjs
bash scripts/bootstrap_trask_indexer.sh
source .venv-trask-indexer/bin/activate
python scripts/smoke_trask_indexed_stack.py
```

## CLI commands

```bash
python -m trask_indexer.cli list-seeds
python -m trask_indexer.cli crawl-seeds [--source-id ID] [--limit N] [--dry-run]
python -m trask_indexer.cli drain-queue [--dry-run]
python -m trask_indexer.cli serve --port 8790
```

Shell wrappers: `scripts/trask_crawl_catalog.sh`, `scripts/trask_indexer_drain_queue.sh`, `scripts/trask_index_golden_corpus.sh`.

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `TRASK_INDEXER_DATA_DIR` | `data/trask-indexer` | Chroma persistence + allowlist JSON |
| `TRASK_EMBED_MODEL` | `BAAI/bge-small-en-v1.5` | FastEmbed model id |
| `TRASK_CHROMA_COLLECTION` | `trask_dev` | Collection name |
| `INGEST_STATE_DIR` | `data/ingest-worker` | Shared reindex queue for `drain-queue` |

## VPS roles (production)

- **Crawler VPS:** Chromium + Crawl4AI jobs (`crawl-seeds`, `drain-queue`)
- **Index VPS:** FastEmbed + Chroma HTTP + `POST /retrieve`
- **API VPS:** `trask-http-server` with `TRASK_INDEXER_BASE_URL` pointing at the retrieve Worker

Research uses `scripts/trask_web_research.py` (Python subprocess) — not a separate Node `TRASK_RESEARCH_BACKEND` flag.
