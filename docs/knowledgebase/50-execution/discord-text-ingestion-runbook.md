---
title: Discord Text Ingestion Runbook
owner: ingest-worker
status: active
lastUpdated: 2026-05-15
---

# Chroma auto-index (preferred for Trask RAG)

1. [REPO] Seed or run the indexer: `bash scripts/bootstrap_trask_indexer.sh`, `bash scripts/trask_index_seed_for_qa.sh` (fixtures), `trask-indexer serve` on `TRASK_INDEXER_BASE_URL`.
2. [REPO] One-time or CI sync (all guilds in `TRASK_ALLOWED_GUILD_IDS`):

```bash
export TRASK_DISCORD_BOT_TOKEN=...
export TRASK_ALLOWED_GUILD_IDS=123,456
export TRASK_DISCORD_CHANNEL_BLACKLIST=   # optional comma-separated channel IDs to skip
python scripts/trask_discord_sync.py
```

3. [REPO] Continuous sync on the Trask bot: set `TRASK_DISCORD_SYNC_INTERVAL_MS` (e.g. `3600000`). Blacklist via `TRASK_DISCORD_CHANNEL_BLACKLIST`. Sync logs chunk counts; `GET /health` on the indexer may include `last_discord_sync` from `data/trask-indexer/discord_sync_status.json`.
4. [SYNTH] This path writes to **Chroma** (`infra/trask-indexer`). It does **not** populate `FileChunkStore` under `INGEST_STATE_DIR`.

# Legacy export + FileChunkStore import

1. [REPO] Ensure bot token and guild id are available.
2. [REPO] Run text-focused export:

```bash
python scripts/export_discord_server.py \
  --token-env TRASK_DISCORD_BOT_TOKEN \
  --guild-id-env TRASK_DISCORD_GUILD_ID \
  --fallback-guild-id-env DISCORD_TARGET_GUILD_ID \
  --no-assets \
  --no-reaction-users \
  --exclude-private-archived-threads \
  --json-summary
```

3. [SYNTH] Keep export directory path for import step.

# Import

1. [SYNTH] Dry run first:

```bash
pnpm --filter @openkotor/ingest-worker dev import-discord-export <export-dir> --dry-run
# or, from repo root if pnpm is unavailable:
npx tsx apps/ingest-worker/src/main.ts import-discord-export <export-dir> --dry-run
```

2. [SYNTH] Apply import:

```bash
pnpm --filter @openkotor/ingest-worker dev import-discord-export <export-dir>
# or:
npx tsx apps/ingest-worker/src/main.ts import-discord-export <export-dir>
```

3. [REPO] Verify indexed sources:

```bash
pnpm --filter @openkotor/ingest-worker dev show-indexed
# or:
npx tsx apps/ingest-worker/src/main.ts show-indexed
```

# Importer chunking (code)

- [REPO] `import-discord-export` builds windows until **25** non-empty message lines **or** **~380 words** in the current window, then flushes one chunk (`apps/ingest-worker/src/discord-export-import.ts`).
- [SYNTH] Tuning “noise vs context” without code changes: prefer export filters (narrower channels) and Trask synthesis weighting; changing window thresholds requires editing those constants and re-importing.

# Validate

- [SYNTH] Confirm `approved-discord-knowledge` has chunk records and a source index.
- [SYNTH] Ask known fixture questions in Trask and verify source citations include imported Discord chunks when relevant.
- [SYNTH] If noisy results appear, narrow the export channel list or tighten synthesis weighting; window size is fixed in code (see **Importer chunking** above).

# Rollback

- [SYNTH] Temporarily disable local Discord context weighting in Trask synthesis.
- [SYNTH] Re-run import after redaction/config adjustments.

# Related

- [ingest-worker-cli-runbook.md](ingest-worker-cli-runbook.md) — `import-discord-export`, `show-indexed`, queue commands.
- [trask-configuration-env-map.md](trask-configuration-env-map.md) — `INGEST_STATE_DIR` and shared AI vars.
- [trask-reindex-queue-contract.md](../10-architecture-runtime/trask-reindex-queue-contract.md) — catalog `queue-reindex` / worker drain (not Discord import).
- [trask-research-troubleshooting.md](trask-research-troubleshooting.md) — `INGEST_STATE_DIR` and chunk visibility.
