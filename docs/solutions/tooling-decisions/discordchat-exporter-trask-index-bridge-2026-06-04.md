---
title: "DiscordChatExporter scrape ↔ Trask index two-repo bridge"
date: 2026-06-04
category: tooling-decisions
problem_type: integration
component: trask
module: trask
tags:
  - trask
  - discord
  - discord-chat-exporter
  - recurring-scrape
  - chroma
  - ingestion
applies_when: "Maintaining Discord archives with DCE recurring scrape and serving them in Trask/Holocron RAG"
---

## Problem

KotOR Discord evidence is maintained in a **DiscordChatExporter fork** (`feat/recurring-cli-scrape`) with Docker/cron append-only scrapes, KotOR ladder/catchup tooling, and 28 offline smokes. Trask indexes Discord through **community-bots** (`scripts/trask_discord_sync.py` → `discord_index.py` → Chroma). Agents working in only one repo miss the handoff, and `output_dir` paths were never documented cross-repo.

A second issue: **on-disk JSON layouts differ**. DCE recurring scrape writes flat `*[channel_id].json` files; Trask's indexer expects `manifest.json` + `containers/` (same as `export_discord_server.py`). Pointing Trask at a DCE-only folder silently indexes nothing.

## Solution

**Document and wire the two-repo contract in community-bots** (agent-first):

| Artifact | Purpose |
|----------|---------|
| `docs/knowledgebase/50-execution/discordchat-exporter-trask-bridge-runbook.md` | Operator + agent runbook (workflow, format bridge, config mapping, KotOR ladder) |
| `data/trask/discord-export-targets.json` | Trask index targets aligned by name/`output_dir` with DCE scrape config (disabled until manifest layout) |
| `scripts/trask_discord_sync_after_scrape.sh` | Post-scrape sync entry with layout preflight |
| `AGENTS.md` Learned Workspace Facts | One-line pointer so every agent session sees the bridge |

**Keep scrape automation in the DCE fork** — do not duplicate `run-discord-scrape.sh`, cron, or smoke tests here.

## Config contract

- **Export:** DCE `config/scrape-targets.json` — `name`, `output_dir`, `enabled`, optional `channel_ids`, `container_memory`
- **Index:** `data/trask/discord-export-targets.json` — same `name`/`output_dir` semantics; `channel_ids` = Trask allowlist

Shared paths typically under `~/Documents/<target>/` per maintainer config.

## Format bridge (current)

| Layout | Producer | Trask indexer |
|--------|----------|---------------|
| `manifest.json` + `containers/*.json` | `scripts/export_discord_server.py` | Supported |
| Flat `Guild - … [channel_id].json` | DCE `run-discord-scrape.sh` merge | **Not supported yet** |

Until flat-json ingestion exists, operators either:

1. Run bot export into a Trask-dedicated tree, or
2. Use DCE archives for backup only and accept Trask uses live/bot export path

## Verification

```bash
# DCE fork (external)
DCE_MIN_FREE_MB=0 ./scripts/run-all-smokes.sh

# community-bots
python scripts/trask_discord_sync.py
bash scripts/trask_indexed_stack_health.sh --strict-stale
pnpm trask:gate
```

## Deferred

- `discord_index.py` adapter for DCE flat channel JSON
- Auto-sync hook from DCE cron into `trask_discord_sync.py`
- Upstream Tyrrrz PR (private fork; local smokes are gate)

## References

- Bridge runbook: `docs/knowledgebase/50-execution/discordchat-exporter-trask-bridge-runbook.md`
- DCE merge-readiness: external `docs/recurring-scrape-merge-readiness.md`
- DCE architecture pattern: external `docs/solutions/architecture-patterns/discord-append-only-incremental-scrape-docker-cron.md`
