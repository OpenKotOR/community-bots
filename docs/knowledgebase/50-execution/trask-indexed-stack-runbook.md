---
title: Trask Indexed Stack Runbook
owner: trask-http-server
status: active
lastUpdated: 2026-05-23
---

# Trask indexed stack (Crawl4AI + Chroma + Worker)

Operator guide for the self-hosted Trask research path: crawl → embed → Chroma → retrieve Worker → Holocron / Discord.

## Components

| Service | Local port | Role |
|---------|------------|------|
| Chroma indexer | 8790 | FastEmbed + Chroma + `POST /retrieve` |
| Retrieve Worker | 8787 | Cloudflare Worker proxy to indexer (production parity) |
| trask-http-server | 4010 | Holocron UI + `/api/trask/*` |

Research subprocess: `scripts/trask_web_research.py` → retrieve URL from `TRASK_INDEXER_BASE_URL` (Worker, not raw Chroma).

## Bootstrap (first time)

```bash
pnpm --filter @openkotor/retrieval build
node scripts/export_trask_allowlist_catalog.mjs
bash scripts/bootstrap_trask_indexer.sh
bash scripts/trask_index_seed_for_qa.sh   # golden fixtures for e2e / local QA
```

## Live local stack

```bash
pnpm build   # when TypeScript in trask / holocron changed
bash scripts/trask_live_stack.sh
```

Verify:

```bash
curl -sf http://127.0.0.1:4010/ >/dev/null && echo Holocron OK
curl -sf http://127.0.0.1:8787/health
curl -sf http://127.0.0.1:8790/health
```

Open Holocron at http://127.0.0.1:4010 (not Vite :5174 alone for research validation).

## Batch crawl (full allowlist)

```bash
bash scripts/trask_crawl_catalog.sh              # crawl all catalog home URLs
bash scripts/trask_index_golden_corpus.sh        # same, with optional TRASK_GOLDEN_CORPUS_LIMIT
bash scripts/trask_crawl_catalog.sh --dry-run    # list seeds only
```

## Reindex queue → Chroma

Discord `/queue-reindex` and ingest-worker CLI enqueue catalog source ids into `INGEST_STATE_DIR/reindex-queue.json`. Drain into Chroma with:

```bash
bash scripts/trask_indexer_drain_queue.sh
bash scripts/trask_indexer_drain_queue.sh --dry-run
bash scripts/trask_indexer_run_queue_worker.sh [pollMs]
```

Uses the same lock contract as ingest-worker (`reindex-queue.lock`). Do not run ingest-worker `drain-queue` and indexer `drain-queue` concurrently on the same `INGEST_STATE_DIR`.

## Discord → Chroma sync

```bash
python scripts/trask_discord_sync.py
```

Enable periodic sync on trask-bot with `TRASK_DISCORD_SYNC_INTERVAL_MS` > 0. Indexer `GET /health` exposes `last_discord_sync`, `discord_sync_age_hours`, and `discord_sync_stale` (default stale threshold: 48h via `TRASK_DISCORD_SYNC_STALE_HOURS`).

## Backup / restore (Chroma)

Chroma persists under `TRASK_INDEXER_DATA_DIR/chroma` (default `data/trask-indexer/chroma`).

```bash
bash scripts/trask_chroma_backup.sh
bash scripts/trask_chroma_backup.sh --dry-run
bash scripts/trask_chroma_backup.sh --output-dir /var/backups/trask

# Stop indexer first, then:
bash scripts/trask_chroma_restore.sh data/trask-indexer/backups/trask-chroma-YYYYMMDDTHHMMSSZ.tar.gz
```

Manual equivalent:

```bash
tar -czf trask-chroma-backup-$(date +%Y%m%d).tar.gz -C data/trask-indexer chroma
```

## Verification gates

| Gate | Command |
|------|---------|
| Indexer unit tests | `pnpm trask:indexer:test` (after `bootstrap_trask_indexer.sh`) |
| Holocron e2e (5 queries) | `pnpm holocron:e2e` |
| CLI QA | `pnpm verify:trask-cli` |
| Offline faithfulness | `pnpm trask:faithfulness-eval` |
| Indexer smoke | `python scripts/smoke_trask_indexed_stack.py --golden-fixtures --verify-retrieve` |

## Key environment variables

See [trask-configuration-env-map.md](trask-configuration-env-map.md). Indexed path essentials:

- `TRASK_INDEXER_BASE_URL` — retrieve Worker URL (local: `http://127.0.0.1:8787`)
- `TRASK_INDEXER_DATA_DIR` — Chroma + allowlist data
- `INGEST_STATE_DIR` — reindex queue location (default `data/ingest-worker`)
- `TRASK_WEB_ALLOW_ANONYMOUS=1` — anonymous Holocron on standalone trask-http-server

## Related

- [trask-reindex-queue-contract.md](../10-architecture-runtime/trask-reindex-queue-contract.md)
- [trask-crawl4ai-research-cutover-2026-05-19.md](../../solutions/tooling-decisions/trask-crawl4ai-research-cutover-2026-05-19.md)
- `infra/trask-indexer/README.md`
