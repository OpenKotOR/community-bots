---
title: Trask Indexed Stack Runbook
owner: trask-http-server
status: active
lastUpdated: 2026-05-23
---

# Trask indexed stack (Crawl4AI + Chroma + Worker)

Operator guide for the self-hosted Trask research path: crawl → embed → Chroma → retrieve Worker → Holocron / Discord.

**VPS rollout checklist:** [trask-vps-indexed-stack-rollout-2026-05-24.md](../../solutions/tooling-decisions/trask-vps-indexed-stack-rollout-2026-05-24.md)

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
bash scripts/trask_indexed_stack_health.sh
bash scripts/trask_indexed_stack_health.sh --check-http
curl -sf http://127.0.0.1:4010/ >/dev/null && echo Holocron OK
curl -sf http://127.0.0.1:8787/health
curl -sf http://127.0.0.1:8790/health
```

Open Holocron at http://127.0.0.1:4010 (not Vite :5174 alone for research validation).

## QA auto-bootstrap (live gates)

Holocron e2e, `pnpm verify:trask-cli`, and `pnpm verify:trask-discord` call **`scripts/lib/trask_qa_stack_bootstrap.mjs`**, which applies CI-parity env and runs **`bash scripts/ensure_trask_indexed_stack_for_e2e.sh`** when indexer (**8790**) or Worker (**8787**) is unhealthy. Playwright uses **`scripts/holocron-e2e-webserver.mjs`** (does not bind **4010** until the live server step).

Compound reference: [trask-qa-stack-bootstrap-2026-05-24.md](../../solutions/tooling-decisions/trask-qa-stack-bootstrap-2026-05-24.md).

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

Enable periodic sync on trask-bot with `TRASK_DISCORD_SYNC_INTERVAL_MS` > 0 (production template: `infra/trask-bot-stack/.env.production.example`, default **1800000** = 30 min). Indexer `GET /health` exposes `last_discord_sync`, `discord_sync_age_hours`, and `discord_sync_stale` (default stale threshold: 48h via `TRASK_DISCORD_SYNC_STALE_HOURS`).

## Backup / restore (Chroma)

Chroma persists under `TRASK_INDEXER_DATA_DIR/chroma` (default `data/trask-indexer/chroma`).

```bash
bash scripts/trask_chroma_backup.sh
bash scripts/trask_chroma_backup.sh --dry-run
bash scripts/trask_chroma_backup.sh --output-dir /var/backups/trask

# Scheduled (cron): backup + retain N local copies + optional off-site upload
bash scripts/trask_chroma_backup_scheduled.sh
TRASK_CHROMA_BACKUP_RETAIN=7 \
TRASK_CHROMA_BACKUP_UPLOAD_CMD='aws s3 cp "$ARCHIVE" s3://my-bucket/trask-chroma/' \
  bash scripts/trask_chroma_backup_scheduled.sh

# Cron example: infra/trask-indexer/cron/trask-chroma-backup.cron.example

# Stop indexer first, then:
bash scripts/trask_chroma_restore.sh data/trask-indexer/backups/trask-chroma-YYYYMMDDTHHMMSSZ.tar.gz
```

Manual equivalent:

```bash
tar -czf trask-chroma-backup-$(date +%Y%m%d).tar.gz -C data/trask-indexer chroma
```

## VPS systemd (indexer + queue worker)

Templates under `infra/trask-indexer/systemd/`:

- `trask-indexer.service.example` — `trask-indexer serve` on `:8790`
- `trask-indexer-queue-worker.service.example` — continuous `drain-queue` loop

Bot deploy: `infra/trask-bot-stack/` (Discord sync interval, separate host or same VPS).

Retrieve Worker on VPS (co-located wrangler proxy, production parity with local stack):

- `scripts/trask_retrieve_worker_start.sh` — `:8787` → indexer `:8790`
- `infra/trask-retrieve-worker/systemd/trask-retrieve-worker.service.example`
- **Alternative:** Cloudflare `wrangler deploy` (edge); set clients to Workers URL

Set `TRASK_INDEXER_BASE_URL=http://127.0.0.1:8787` on bot and trask-http-server when using co-located Worker.

After install:

```bash
bash scripts/trask_indexed_stack_health.sh
bash scripts/trask_indexed_stack_health.sh --check-http   # when trask-http-server on :4010
bash scripts/trask_indexed_stack_health.sh --strict-stale # fail if discord_sync_stale
```

## Verification gates

| Gate | Command |
|------|---------|
| Citation offline (Discord stress + faithfulness) | `pnpm trask:gate` (recommended: one build, smoke, full measure with skip-check, `:ci`); floor `composite_score` **165** — see [stack closeout](../../solutions/tooling-decisions/trask-citation-stack-closeout-2026-05-24.md), [module architecture](../../solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md), [display contract](../10-architecture-runtime/trask-citation-display-contract.md) |
| Discord `/ask` live | `pnpm verify:trask-discord` (preflight `pnpm trask:gate`; script auto-bootstraps indexer+Worker when unhealthy) |
| Indexer unit tests | `pnpm trask:indexer:test` (after `bootstrap_trask_indexer.sh`) |
| Holocron e2e (5 queries) | `pnpm holocron:e2e` — CI passes optional `OPENROUTER_API_KEY` / `OPENAI_API_KEY` repo secrets for richer LLM compose |
| CLI QA | `pnpm verify:trask-cli` (preflight `pnpm trask:gate`; script auto-bootstraps indexer+Worker when unhealthy) |
| Offline faithfulness | `pnpm trask:faithfulness-eval` |
| Stack health (VPS) | `bash scripts/trask_indexed_stack_health.sh [--check-http]` |

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
