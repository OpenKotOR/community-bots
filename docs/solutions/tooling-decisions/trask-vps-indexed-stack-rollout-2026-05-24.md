---
title: "Trask VPS indexed stack rollout checklist"
date: 2026-05-24
last_refreshed: 2026-05-24
category: tooling-decisions
problem_type: runbook
component: infrastructure
module: trask
tags:
  - "trask"
  - "holocron"
  - "vps"
  - "indexer"
  - "chroma"
  - "systemd"
applies_when: "Deploying or validating the self-hosted Trask indexed stack on a VPS after PR #9–#12"
---

## Context

PR #9–#12 landed operator artifacts for the Crawl4AI + Chroma path: queue drain/worker, Discord sync health, Chroma backup/cron, bot deploy manifest, indexer + retrieve Worker systemd templates, and `pnpm trask:stack:health`. The detailed runbook remains at `docs/knowledgebase/50-execution/trask-indexed-stack-runbook.md`; this doc is the **ordered rollout checklist** agents and operators follow once.

## Indexed vs legacy storage

| Path | Authority | Notes |
|------|-----------|--------|
| **Chroma + Worker** | **Yes** — Holocron/Discord research | `TRASK_INDEXER_BASE_URL` → `:8787` Worker; Discord sync → Chroma |
| **FileChunkStore** | Legacy / deferred | `INGEST_STATE_DIR/chunks`; ingest-worker only; **not** merged into compose (see `docs/plans/2026-05-24-017-defer-filechunkstore-merge-plan.md`) |

Do not point new operators at ingest-worker chunk paths for Holocron answers — use the indexed stack checklist below.

## VPS rollout checklist

Assume repo checkout at `/opt/community-bots` (adjust paths in systemd units).

### 1. Bootstrap (once)

- [ ] Node.js ≥24, pnpm 10 (`corepack enable`)
- [ ] `pnpm install && pnpm build`
- [ ] `bash scripts/bootstrap_trask_indexer.sh`
- [ ] `node scripts/export_trask_allowlist_catalog.mjs`
- [ ] Optional QA seed: `bash scripts/trask_index_seed_for_qa.sh`

### 2. Environment

- [ ] Copy `infra/trask-bot-stack/.env.production.example` → `/opt/community-bots/.env`
- [ ] Set `TRASK_DISCORD_BOT_TOKEN`, guild/channel IDs, `OPENROUTER_API_KEY` or `OPENAI_API_KEY`
- [ ] Set `TRASK_INDEXER_BASE_URL=http://127.0.0.1:8787` (co-located Worker) **or** Cloudflare Workers URL after `wrangler deploy`
- [ ] Set `TRASK_DISCORD_SYNC_INTERVAL_MS=1800000` (30 min) for continuous Discord→Chroma sync

### 3. systemd services (recommended order)

| Order | Unit template | Purpose |
|-------|---------------|---------|
| 1 | `infra/trask-indexer/systemd/trask-indexer.service.example` | Chroma indexer `:8790` |
| 2 | `infra/trask-retrieve-worker/systemd/trask-retrieve-worker.service.example` | Worker proxy `:8787` |
| 3 | `infra/trask-indexer/systemd/trask-indexer-queue-worker.service.example` | Continuous reindex queue drain |
| 4 | `infra/trask-bot-stack/trask-bot.service.example` | Discord bot + periodic sync |

Install: `sudo cp … /etc/systemd/system/`, edit `User=`/`WorkingDirectory=`, `daemon-reload`, `enable --now`.

**Cloudflare alternative:** skip step 2 on VPS; deploy `infra/trask-retrieve-worker` with `wrangler deploy` and point `TRASK_INDEXER_BASE_URL` at the Workers URL.

### 4. Backup cron

- [ ] Install `infra/trask-indexer/cron/trask-chroma-backup.cron.example` (daily)
- [ ] Optional off-site: `TRASK_CHROMA_BACKUP_UPLOAD_CMD='aws s3 cp "$ARCHIVE" s3://…'`

### 5. Verification gates

```bash
pnpm trask:stack:health
bash scripts/trask_indexed_stack_health.sh --check-http   # when trask-http-server on :4010
pnpm trask:indexer:test                 # after bootstrap
pnpm verify:trask-cli                   # golden queries (needs LLM key)
pnpm holocron:e2e                       # full browser gate (CI parity)
pnpm verify:trask-discord               # when bot token + Discord access
```

Indexer stale sync: `curl -s http://127.0.0.1:8790/health | jq .discord_sync_stale`

### 6. Holocron / HTTP (optional same host)

- [ ] `node scripts/holocron-e2e-live-build.mjs` or `pnpm build`
- [ ] `TRASK_WEB_ALLOW_ANONYMOUS=1 TRASK_INDEXER_BASE_URL=http://127.0.0.1:8787 bash scripts/holocron-e2e-live-server.sh`
- [ ] Or use `bash scripts/trask_live_stack.sh` for local dev parity

## Why This Matters

Without a single checklist, operators must reverse-engineer `trask_live_stack.sh` and scattered systemd examples. This doc ties PR #9–#11 artifacts into one path and matches CI contract (`TRASK_INDEXER_BASE_URL` → Worker, not raw Chroma).

## Related

- `docs/knowledgebase/50-execution/trask-indexed-stack-runbook.md`
- `infra/trask-bot-stack/README.md`
- `infra/trask-retrieve-worker/README.md`
- `docs/solutions/tooling-decisions/trask-crawl4ai-research-cutover-2026-05-19.md`

## History

- **2026-05-24:** Initial checklist after PR #9–#11 ops closure merge.
