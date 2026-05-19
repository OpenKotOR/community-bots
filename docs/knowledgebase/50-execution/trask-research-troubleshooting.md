---
title: Trask Research Troubleshooting
owner: trask-bot
status: active
lastUpdated: 2026-05-18
---

[SYNTH] Operator-facing symptoms for **live research + local chunks**. Deep setup remains in [docs/trask.md](../../trask.md); architecture in [trask-synthesis-and-chunk-retrieval.md](../10-architecture-runtime/trask-synthesis-and-chunk-retrieval.md).

# Headless web research / empty or missing answers

- [REPO] **“No approved research sources are enabled.”** — `WebResearchClient` received an empty approved list after Holocron source preferences (or misconfiguration). Check enabled roots in the UI and [trask-configuration-env-map.md](trask-configuration-env-map.md).
- [REPO] **“Trask web research returned an empty report.”** — subprocess returned no `report` text. Run `bash scripts/bootstrap_trask_research.sh`, set `TRASK_WEB_RESEARCH_PYTHON`, and verify `python scripts/smoke_trask_web_research.py --dry-run` ([docs/trask-research-backends.md](../../trask-research-backends.md)).
- [SYNTH] **Python import / version errors in logs** — reinstall with `bash scripts/bootstrap_trask_research.sh` (`requirements-trask-research.txt`). On Fedora/RHEL install `libxml2-devel` and `libxslt-devel` before bootstrap.

# Timeouts

- [REPO] Config default **`TRASK_WEB_RESEARCH_TIMEOUT_MS`** is **900000** ms when unset (legacy alias **`TRASK_RESEARCHWIZARD_TIMEOUT_MS`**) (`packages/config/src/index.ts`).
- [REPO] Discord **`/ask`** uses **`Math.min(config.webResearch.timeoutMs, 90_000)`** and a **90s** interaction race in `apps/trask-bot/src/main.ts` — raising the env var above 90s does **not** extend Discord beyond that SLA.
- [SYNTH] Holocron via **`trask-http-server`** can use the full configured timeout unless another proxy cuts the connection first.

# Local chunks never appear

- [REPO] **`INGEST_STATE_DIR`** must match between **ingest** (writer) and **answer** runtime (Trask bot, Trask HTTP, Pazaak bot). Default **`data/ingest-worker`** in config loaders; Pazaak uses the same var for its chunk provider ([trask-configuration-env-map.md](trask-configuration-env-map.md)).
- [REPO] On disk: **`$INGEST_STATE_DIR/chunks/<sourceId>/*.json`** plus optional **`_index.json`** per source (`FileChunkStore` in `packages/retrieval`).
- [SYNTH] If imports target one machine and the bot reads another path (container volume mismatch), search returns zero hits with no error.

# Proactive / brief path oddities

- [REPO] Proactive uses **`answerQuestionBrief`** then **`scoreResearchAlignment`**; requires embedding-capable shared AI config ([trask-proactive-mode-contract.md](../10-architecture-runtime/trask-proactive-mode-contract.md)).
- [SYNTH] **Classifier rejects** or **similarity below threshold** — tune `TRASK_PROACTIVE_*` env vars or confirm messages are real KotOR questions in allowlisted channels.

# Weak or noisy chunk matches

- [REPO] **`ChunkSearchProvider`** scores with token overlap over titles, tags, and body text ([trask-synthesis-and-chunk-retrieval.md](../10-architecture-runtime/trask-synthesis-and-chunk-retrieval.md)).
- [SYNTH] Very short queries or vocabulary mismatch yields few hits; approved catalog web search still runs unless the whole pipeline fails.

# Catalog reindex queued but chunks stale

- [SYNTH] Discord **`/queue-reindex`** (or CLI **`queue-reindex`**) only **enqueues** catalog source ids in **`reindex-queue.json`**; **`FileChunkStore`** updates when **ingest-worker** runs **`drain-queue`** or **`run-queue-worker`** on the **same** **`INGEST_STATE_DIR`** ([trask-reindex-queue-contract.md](../10-architecture-runtime/trask-reindex-queue-contract.md), [ingest-worker-cli-runbook.md](ingest-worker-cli-runbook.md)).

# Related

- [discord-text-ingestion-runbook.md](discord-text-ingestion-runbook.md) — export/import path.
- [trask-reindex-queue-contract.md](../10-architecture-runtime/trask-reindex-queue-contract.md) — queue file, lock, worker drain.
- [validation-ladder.md](validation-ladder.md) — how to verify changes safely.
