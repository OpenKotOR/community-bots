---
title: DiscordChatExporter recurring scrape → Trask index bridge
owner: trask-bot
status: active
lastUpdated: 2026-06-13
---

# DiscordChatExporter scrape ↔ Trask evidence cache

[SYNTH] **Two-repo operator contract:** append-only Discord archives are **scraped** in the DiscordChatExporter fork; **indexed into Trask Chroma** from this repo (`community-bots`). Agents must read this doc before wiring `output_dir` paths or claiming Discord evidence is fresh in Holocron `/ask`.

## Repo roles

| Repo | Path (maintainer) | Owns |
|------|-------------------|------|
| **DiscordChatExporter fork** | `~/Downloads/DiscordChatExporter` (or `/run/media/brunner56/MyBook/Downloads/DiscordChatExporter`) | Docker/cron scrape, `config/scrape-targets.json`, `scrape.env`, KotOR ladder/catchup wrappers, 28/28 offline smokes |
| **GUI zip sibling** | `~/Downloads/DiscordChatExporter.linux-x64/` | Desktop app + `bootstrap-recurring-scrape.sh` stub + synced `RECURRING-SCRAPE.md` |
| **community-bots** (this repo) | `~/Workspaces/community-bots` | Trask indexer, `data/trask/discord-export-targets.json`, `scripts/trask_discord_sync.py`, Holocron, `/ask` |

[REPO] DCE fork branch: `feat/recurring-cli-scrape`. Authoritative operator docs there: `docs/recurring-scrape-merge-readiness.md`, `docs/gui-zip-recurring-scrape-bridge.md`, `.docs/Recurring-Scrape-Setup.md`.

## End-to-end workflow

```text
1. DCE: operator-handoff → bootstrap-recurring-scrape → run-documents-scrape (or cron)
2. DCE (KotOR): run-kotor-preflight-ladder.sh → re-run after token → run-kotor-yes-general-catchup.sh
3. community-bots: align data/trask/discord-export-targets.json (see Format bridge below)
4. community-bots: python scripts/trask_discord_sync.py
5. community-bots: bash scripts/trask_indexed_stack_health.sh --strict-stale
6. community-bots: pnpm verify:trask-discord (when bot token + stack up)
```

Periodic sync alternative: set `TRASK_DISCORD_SYNC_INTERVAL_MS` on trask-bot (`infra/trask-bot-stack/.env.production.example`, default 30 min).

## Format bridge

[REPO] **Trask indexer** (`infra/trask-indexer/trask_indexer/discord_index.py`) indexes either:

| Layout | Producer | Detection |
|--------|----------|-----------|
| `manifest.json` + `containers/*.json` | `scripts/export_discord_server.py` | `manifest.json` + `containers/` at `output_dir` |
| **DCE flat** `* [channel_id].json` | DCE `run-discord-scrape.sh` merge | Flat JSON at `output_dir` (skips `.dce-meta/`, `.dce-temp/`, `*.bak.*`) |

[REPO] **DCE recurring scrape** writes flat per-channel JSON under each target `output_dir`, e.g.:

- `KOTOR - Yes General Chats - yes_general [221726893064454144].json`
- `.dce-meta/`, `.dce-temp/` alongside archives

[SYNTH] **Precedence:** manifest layout wins when both exist at the same path. Mixed trees are unusual — prefer one layout per `output_dir`.

### Post-scrape operator tree (KotOR yes_general pilot)

```text
DCE fork                          community-bots
────────────────────────────────  ────────────────────────────────────
run-kotor-preflight-ladder.sh     (after flat JSON updated on disk)
run-kotor-yes-general-catchup.sh
print-scrape-summary.sh           bash scripts/trask_discord_sync_after_scrape.sh
                                  → expect chunks_indexed > 0, channels_indexed ≥ 1
                                  bash scripts/trask_indexed_stack_health.sh --strict-stale
                                  pnpm verify:trask-discord (when stack + token up)
```

[SYNTH] Sync reports **DEGRADED** when an enabled target indexes **0 chunks** (allowlist mismatch, empty export, or unreadable files). Do not treat sync exit 0 alone as success — read per-target `chunks_indexed` / `channels_indexed`.

### Enablement checklist (flip `KotOR_discord_msgs` to `enabled: true`)

1. DCE catch-up succeeded; flat file exists: `*[221726893064454144].json` under `output_dir`.
2. `channel_ids` includes `221726893064454144` in `data/trask/discord-export-targets.json`.
3. `bash scripts/trask_discord_sync_after_scrape.sh` preflight prints **OK → DCE flat JSON layout**.
4. Pilot sync indexes **≥1 channel** and **>0 chunks**; `discord_sync_status.json` reflects target row.
5. `GET /health` on indexer **8790** shows fresh `last_discord_sync`; run `pnpm trask:gate` after indexer code changes.

### Operator paths (pick one per guild corpus)

| Goal | Path |
|------|------|
| **Personal append-only archive (all channels, cron)** | DCE fork — index via flat adapter after sync |
| **Trask RAG over Discord text (bot export layout)** | `scripts/export_discord_server.py` → `manifest.json` + `containers/` |
| **Both** | Same `output_dir` works when DCE flat files are present; manifest takes precedence if both exist |

## Config mapping

Link targets by **shared logical name** and **filesystem path intent** — two JSON files, not one:

| DCE `config/scrape-targets.json` | Trask `data/trask/discord-export-targets.json` |
|----------------------------------|-----------------------------------------------|
| `name`, `output_dir`, `enabled`, `channel_ids` | `name`, `output_dir`, `enabled`, `channel_ids` (allowlist when non-empty) |
| `container_memory`, scrape locks, salvage | N/A (indexer only reads JSON) |

Example KotOR mapping (Trask side — enable after enablement checklist passes):

```json
{
  "name": "KotOR_discord_msgs",
  "enabled": false,
  "disabled_reason": "Pilot: enable after DCE yes_general flat JSON exists and pilot sync indexes ≥1 channel — see bridge runbook enablement checklist",
  "output_dir": "/home/brunner56/Documents/KotOR_discord_msgs",
  "guild_ids": [],
  "channel_ids": ["221726893064454144"]
}
```

[SYNTH] `channel_ids` on the Trask target is an **allowlist** when non-empty (index only those channels). Global excludes still apply via `TRASK_DISCORD_CHANNEL_BLACKLIST`.

Maintainer scrape targets (DCE, enabled in fork config): `KotOR_discord_msgs`, `openkotor_discord_msgs`, `KotOR_Speedrun_Discord`, `holocron_toolset_discord`, `expanded_kotor_discord`, `eod_discord`, `DS_Discord_msgs`, `ror_orig_discord`, `ror_new_discord` — see DCE `config/scrape-targets.json` for `output_dir` under `~/Documents/`.

## KotOR yes_general operator ladder (DCE fork)

Channel **221726893064454144** (`yes_general`). Run from DCE repo root:

```bash
./scripts/run-kotor-preflight-ladder.sh
# configure token: scrape.env or ./scripts/sync-token-from-gui.sh
./scripts/run-kotor-preflight-ladder.sh          # re-run for authenticated step 2
./scripts/run-kotor-yes-general-catchup.sh       # live catch-up (8g cap in scrape-targets.json)
./scripts/print-scrape-summary.sh logs/kotor-yes-general.summary.json
```

Validate DCE automation: `DCE_MIN_FREE_MB=0 ./scripts/run-all-smokes.sh` (**28/28** offline gate).

After a successful catch-up, run Trask sync from community-bots (`bash scripts/trask_discord_sync_after_scrape.sh`). Flat DCE JSON at the mapped `output_dir` is indexed when the target is enabled.

## Trask sync commands (this repo)

```bash
# From community-bots root, with indexer venv active or TRASK_WEB_RESEARCH_PYTHON set
python scripts/trask_discord_sync.py

# Wrapper with preflight checks (manifest layout reminder)
bash scripts/trask_discord_sync_after_scrape.sh

# Health / stale gate (48h default)
bash scripts/trask_indexed_stack_health.sh --strict-stale
curl -sf http://127.0.0.1:8790/health | jq '.last_discord_sync, .discord_sync_stale'
```

Env: [trask-configuration-env-map.md](trask-configuration-env-map.md) — `TRASK_DISCORD_EXPORT_TARGETS_CONFIG`, `TRASK_DISCORD_SYNC_USE_EXPORT_TARGETS` (default `1`), `TRASK_DISCORD_SYNC_INTERVAL_MS`.

Fallback when targets config missing: `trask_discord_sync.py` uses bot-token live export (`TRASK_DISCORD_BOT_TOKEN` required).

## Agent checklist

When asked to refresh Discord evidence for Trask:

1. Confirm which repo the task touches (scrape vs index).
2. Read Format bridge — enabled targets at DCE flat paths require `*[channel_id].json` files; sync DEGRADED when 0 chunks indexed.
3. After index sync, verify `GET /health` on indexer **8790** and run `pnpm trask:gate` / `pnpm verify:trask-discord` when changing ingestion code.
4. Cite [trask-indexed-stack-runbook.md](trask-indexed-stack-runbook.md) for stack restart rules after indexer changes.

## Related

- [trask-indexed-stack-runbook.md](trask-indexed-stack-runbook.md) — § DiscordChatExporter archives
- [discord-text-ingestion-runbook.md](discord-text-ingestion-runbook.md) — bot export + legacy FileChunkStore
- [discord-history-ingestion.md](../10-architecture-runtime/discord-history-ingestion.md) — architecture
- [../../solutions/tooling-decisions/discordchat-exporter-trask-index-bridge-2026-06-04.md](../../solutions/tooling-decisions/discordchat-exporter-trask-index-bridge-2026-06-04.md) — decision record
- DCE fork: `docs/solutions/architecture-patterns/discord-append-only-incremental-scrape-docker-cron.md` (external repo)
