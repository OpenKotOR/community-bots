---
title: Trask Evidence-Pack Stack Runbook
owner: trask-http-server
status: active
lastUpdated: 2026-05-29
---

# Trask evidence-pack stack (scheduled corpus + retrieve Worker)

Operator guide for the self-hosted Trask research path: scheduled corpus → hybrid retrieve → evidence pack → citation gate → Holocron / Discord. Chroma remains the current local store, but callers should depend on the evidence-pack contract, not the backing store.

**Product requirements crosswalk** (from [trask-self-hosted-research-pipeline-requirements.md](../../brainstorms/trask-self-hosted-research-pipeline-requirements.md)):

| ID | Requirement | Implementation |
|----|-------------|----------------|
| **REQ-A** | Scheduled cached-corpus refresh | Cloudflare cron Worker or GitHub Actions → token-guarded `POST /reindex`; DiscordChatExporter archives via `scripts/trask_discord_sync.py` |
| **REQ-B** | Query-time answers from maintained evidence cache only | `TRASK_WEB_RESEARCH_LIVE_CRAWL=0` on served stack (`trask_live_stack.sh` default); weak retrieve → honest degrade (F3), not per-query crawl |
| **REQ-C** | ≤30s research budget | `TRASK_RESEARCH_BUDGET_MS=30000` clamps gather + compose; stall → grounded template |

**VPS rollout checklist:** [trask-vps-indexed-stack-rollout-2026-05-24.md](../../solutions/tooling-decisions/trask-vps-indexed-stack-rollout-2026-05-24.md)

## Components

| Service | Local port | Role |
|---------|------------|------|
| Chroma indexer | 8790 | Current FastEmbed + Chroma implementation for `POST /retrieve` / `POST /reindex`; replaceable behind evidence-pack DTOs |
| Retrieve Worker | 8787 | Cloudflare Worker proxy to indexer (production parity); clients call this boundary |
| Reindex scheduler | — (Cloudflare cron) | Weekly `scheduled()` → `POST /reindex` (`infra/trask-reindex-scheduler`) |
| trask-http-server | 4010 | Holocron UI + `/api/trask/*` |

Research subprocess: `scripts/trask_web_research.py` → retrieve URL from `TRASK_INDEXER_BASE_URL` (Worker, not raw Chroma). `/retrieve` returns legacy `passages` plus `evidencePack` metadata: backend, retrieval mode, citation-ready count, freshness, Discord locators, deletion state, and authorization hints.

## Weekly corpus refresh (REQ-A)

The cached corpus is re-crawled **weekly** (Mondays 06:00 UTC). Two activators call the
same token-guarded indexer trigger, which runs the batch crawl (the same `run_batch_crawl`
path as the `crawl-seeds` CLI) in the background; storage stays in Chroma on the host.

> **Two different "reindex" mechanisms:** the weekly `POST /reindex` here = **full approved-catalog batch crawl**. The separate `/queue-reindex` + drain-queue worker (below) = **per-source-id queue drain** (`FileReindexQueueStore`). They are distinct; don't conflate them.

```bash
# Indexer must run with a shared token to enable the trigger (forwarded by
# trask_live_stack.sh when TRASK_REINDEX_TOKEN is set in .env / the environment):
TRASK_REINDEX_TOKEN=<secret> trask-indexer serve

# Manual / smoke trigger (202 accepted; runs crawl-seeds in the background):
curl -X POST http://127.0.0.1:8790/reindex \
  -H "Authorization: Bearer <secret>" -H "Content-Type: application/json" \
  -d '{"limit": 5, "dryRun": true}'

# Status (last_started_at / last_result) surfaces in health:
curl -s http://127.0.0.1:8790/health | jq .reindex
```

- **Cloudflare cron:** `infra/trask-reindex-scheduler` (`crons = ["0 6 * * 1"]`); set `TRASK_INDEXER_REINDEX_URL` var + `TRASK_REINDEX_TOKEN` secret. CI dry-runs the bundle.
- **Credential-free:** `.github/workflows/trask-weekly-reindex.yml` (weekly `schedule:`) with `TRASK_INDEXER_REINDEX_URL` + `TRASK_REINDEX_TOKEN` repo secrets.

## Cached-corpus query contract (REQ-B)

[SYNTH] On the default served stack, Holocron and Discord **must not** depend on per-query live crawl. Answers come from the **weekly-refreshed Chroma index** (REQ-A) via the Worker retrieve path.

- [REPO] `scripts/trask_live_stack.sh` sets `TRASK_WEB_RESEARCH_LIVE_CRAWL="${TRASK_WEB_RESEARCH_LIVE_CRAWL:-0}"` and documents the cached-resource contract (REQ-B).
- [REPO] `TRASK_INDEXER_BASE_URL` points at the retrieve Worker (**:8787**), not raw Chroma **:8790** — clients call `POST /retrieve` on the Worker only.
- [SYNTH] When retrieve is weak and live crawl is **off**, the pipeline honest-degrades (F3) rather than blocking on Crawl4AI. Operators may opt in to bounded live crawl (`TRASK_WEB_RESEARCH_LIVE_CRAWL=1`) for recovery experiments; that is **not** the product default.

## Latency budget (REQ-C)

`TRASK_RESEARCH_BUDGET_MS` (default **30000**) clamps gather + each compose LLM call so a
cached-index query stays under ~30s; on stall it falls back to the grounded template
(honest-degrade).

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

## DiscordChatExporter archives → evidence cache

**Full two-repo bridge (DCE recurring scrape fork + this repo):** [discordchat-exporter-trask-bridge-runbook.md](discordchat-exporter-trask-bridge-runbook.md). [SYNTH] DCE append-only scrape writes flat `*[channel_id].json`; this indexer expects **`manifest.json` + `containers/`** unless targets point at a bot-export tree.

```bash
python scripts/trask_discord_sync.py
# or, after DCE scrape with layout preflight:
bash scripts/trask_discord_sync_after_scrape.sh
```

Default export target config: `data/trask/discord-export-targets.json`. Copy the sample and set each target's `output_dir` to your DiscordChatExporter archive path. Archive sync runs only when that config file exists; otherwise `trask_discord_sync.py` falls back to bot-token export (`TRASK_DISCORD_BOT_TOKEN` required).

Target JSON fields:

- `name` — stable target id stored in chunk metadata (`source_target`)
- `output_dir` — DiscordChatExporter export root (`manifest.json` + `containers/`)
- `enabled` / `disabled_reason` — skip disabled targets with an auditable reason
- `guild_ids` — optional filter when resolving export directories
- `channel_ids` — optional **allowlist**; when non-empty, only those channel ids are indexed (global `TRASK_DISCORD_CHANNEL_BLACKLIST` still applies as exclude)

Enabled targets are indexed; disabled targets are reported with `disabled_reason`. The importer namespaces chunks by target/channel, records `source_freshness_at`, `window_content_hash`, `discord_jump_url`, and reconciles by deleting stale rows for a target before reimport.

Enable periodic sync on trask-bot with `TRASK_DISCORD_SYNC_INTERVAL_MS` > 0 (production template: `infra/trask-bot-stack/.env.production.example`, default **1800000** = 30 min). Indexer `GET /health` exposes `last_discord_sync`, `discord_sync_age_hours`, and `discord_sync_stale` (default stale threshold: 48h via `TRASK_DISCORD_SYNC_STALE_HOURS`).

Purge a Discord message from indexed evidence:

```bash
node scripts/trask_ops.mjs purge-discord-message --channel-id <channel> --message-id <message>
node scripts/trask_ops.mjs purge-discord-message --channel-id <channel> --message-id <message> --execute
```

The first command is dry-run; `--execute` deletes rows whose stored message window contains the message id.

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
| Holocron e2e (5 queries) | `pnpm holocron:e2e` — primary validation should work without `OPENAI_API_KEY` / `OPENROUTER_API_KEY`; HF/Cloudflare or deterministic fallback handle compose |
| CLI QA | `pnpm verify:trask-cli` (preflight `pnpm trask:gate`; script auto-bootstraps indexer+Worker when unhealthy) |
| Offline faithfulness | `pnpm trask:faithfulness-eval` |
| Stack health (VPS) | `bash scripts/trask_indexed_stack_health.sh [--check-http]` |

## Key environment variables

See [trask-configuration-env-map.md](trask-configuration-env-map.md). Indexed path essentials:

- `TRASK_INDEXER_BASE_URL` — retrieve Worker URL (local: `http://127.0.0.1:8787`)
- `TRASK_INDEXER_DATA_DIR` — Chroma + allowlist data
- `INGEST_STATE_DIR` — reindex queue location (default `data/ingest-worker`)
- `TRASK_WEB_ALLOW_ANONYMOUS=1` — anonymous Holocron on standalone trask-http-server
- `HF_TOKEN` — primary hosted inference
- `TRASK_CLOUDFLARE_AI_BASE_URL` + `TRASK_CLOUDFLARE_AI_TOKEN` — hosted HA fallback
- `TRASK_DISCORD_EXPORT_TARGETS_CONFIG` — DiscordChatExporter target config override

## Related

- [trask-reindex-queue-contract.md](../10-architecture-runtime/trask-reindex-queue-contract.md)
- [trask-crawl4ai-research-cutover-2026-05-19.md](../../solutions/tooling-decisions/trask-crawl4ai-research-cutover-2026-05-19.md)
- `infra/trask-indexer/README.md`
