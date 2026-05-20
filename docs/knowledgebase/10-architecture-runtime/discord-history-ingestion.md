---
title: Discord History Ingestion Architecture
owner: ingest-worker
status: active
lastUpdated: 2026-05-18
---

# Inputs

- [REPO] `scripts/export_discord_server.py` exports guild metadata and per-container message JSON.
- [REPO] Export supports include/exclude channel filters, archived thread controls, and resume checkpoints.
- [SYNTH] Trask ingestion target is `approved-discord-knowledge` in `FileChunkStore`.
- [REPO] Minimal on-disk example for tests and dry-runs: [fixtures/discord-export-minimal/README.md](../../../fixtures/discord-export-minimal/README.md).

# Normalization Contract

- [SYNTH] Required fields per imported message: guild id, channel/thread id, message id, timestamp, sanitized author, content, optional reference id.
- [REPO] Chunks store `discord://approved-channels/<channelId>/<firstMessageId>-<lastMessageId>` internally; when `guildId` is supplied (export `guild.json` or `--guild-id`), `chunk.url` is `https://discord.com/channels/{guild}/{channel}/{anchorMessage}` with tags `guild:`, `channel:`, `anchorMessage:`.
- [SYNTH] Drop non-text-only payloads in this pass except minimal metadata references.
- [SYNTH] Redact mention storms, emails, obvious secrets, and invite links before chunking.

# Chunking Strategy

- [REPO] Importer flushes a window when **message count ≥ 25** or **word count ≥ 380** (per-message line is timestamp + author + content; see `DISCORD_IMPORT_WINDOW_MESSAGES` / `DISCORD_IMPORT_MAX_WORDS` in `apps/ingest-worker/src/discord-export-import.ts`).
- [SYNTH] Chunk by ordered conversation windows (not one chunk per message) to preserve Q&A context.
- [SYNTH] Keep overlap for continuity and include lightweight transcript headers.
- [SYNTH] Tag chunks with `discord`, channel slug, and classifier hints (`qa`, `welcome`, `troubleshooting`) where available.

# Integration

- [SYNTH] Importer writes chunks and source index manifest for `approved-discord-knowledge`.
- [REPO] Trask Discord bot `/ask` searches imported chunks **and** live approved-channel history (bounded pagination) in parallel, then merges hits into `webResearch.answerQuestion(query, undefined, { localHits })`.
- [SYNTH] Deep history still depends on periodic export/import; live fetch covers recent messages within per-request budgets.

# Related

- [discord-text-ingestion-runbook.md](../50-execution/discord-text-ingestion-runbook.md) — operator export/import.
- [trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md) — chunk search at answer time.
- [trask-reindex-queue-contract.md](trask-reindex-queue-contract.md) — catalog refresh queue (separate from Discord import).

