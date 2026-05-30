---
title: Caveat Register
owner: trask-bot
status: active
lastUpdated: 2026-05-15
---

# Active Caveats

- [OPEN] Discord export coverage is limited to channels and threads visible to the bot.
- [OPEN] Private archived threads are excluded by default in this pass.
- [OPEN] Message edits/deletes can drift from imported snapshots unless periodic refresh is run.
- [OPEN] Discord conversational tone can bias answer wording unless balanced by higher-authority sources.
- [OPEN] `discord://` citations are audit-useful but not directly browsable for all users.
- [OPEN] CI or sandboxes without `pnpm`/`corepack` require alternate commands (`npx tsc`, `npx tsx apps/ingest-worker/...`); see validation ladder and runbook.
- [OPEN] `docs/trask-research-backends.md` must stay aligned with KB on `TRASK_WEB_RESEARCH_LIVE_CRAWL` (REQ-B: default **`0`** on served stack, not `1`).
- [OPEN] Chunk retrieval uses lexical token overlap only (no dense embeddings in the **FileChunkStore** path); indexed Chroma retrieve uses dense + lexical RRF with **bounded top-k recall** (~15–30 candidates → top `limit`), not exhaustive full-corpus scan ([answer-pipeline.md](../10-architecture-runtime/answer-pipeline.md), `chroma_store.py`).

# Mitigations

- [SYNTH] Keep source authority ordering explicit in synthesis.
- [SYNTH] Preserve redaction and dry-run checks in importer.
- [SYNTH] Maintain operator runbook for export/import/rollback.
