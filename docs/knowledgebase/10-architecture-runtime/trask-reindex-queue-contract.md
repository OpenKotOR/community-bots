---
title: Trask Reindex Queue Contract
owner: ingest-worker
status: active
lastUpdated: 2026-05-15
---

# Purpose

- [REPO] Operators enqueue **catalog source** refresh jobs (web/GitHub entries in `defaultSourceCatalog`) without blocking Discord or the Trask answer path. Workers drain the queue and write **`FileChunkStore`** chunks under the same **`INGEST_STATE_DIR`** used at answer time.

# Persistence (`FileReindexQueueStore`)

- [REPO] **`$stateDir/reindex-queue.json`** — JSON `{ version: 1, queuedSourceIds: string[] }`. Missing file behaves as an empty queue.
- [REPO] **`$stateDir/reindex-queue.lock`** — exclusive lock during enqueue/dequeue; **5s** acquisition timeout, **50ms** retry interval, lock considered stale after **5 minutes** mtime age (then removed and retried). Heartbeat `utimes` every **30s** while held (`packages/retrieval/src/index.ts`).
- [REPO] Corrupt `reindex-queue.json` is renamed to **`reindex-queue.json.corrupt.<timestamp>`** and replaced with an empty queue state.

# Who enqueues

- [REPO] **`StaticCatalogSearchProvider.queueReindex(sourceIds?)`** — resolves ids against **`this.sources`** (default **`defaultSourceCatalog`**). If `sourceIds` is omitted or empty, **every** catalog `id` is queued. Unknown ids are dropped; dedupe preserves first-seen order then appends only new ids to the persisted queue via **`enqueue`**.
- [REPO] **`ChunkSearchProvider.queueReindex`** delegates to the wrapped catalog’s **`queueReindex`** (same `reindex-queue.json` under **`stateDir`** passed to **`createChunkSearchProvider`**).
- [REPO] **`apps/trask-bot`** slash **`/queue-reindex`** calls **`searchProvider.queueReindex`** with optional single source id ([trask-discord-slash-contract.md](trask-discord-slash-contract.md)).
- [REPO] **`apps/ingest-worker`** CLI **`queue-reindex [sourceIds...]`** calls the same **`SearchProvider.queueReindex`** API ([ingest-worker-cli-runbook.md](../50-execution/ingest-worker-cli-runbook.md)).

# Who drains

- [REPO] **`drain-queue`** in **`apps/ingest-worker/src/main.ts`** — **`dequeueAll`** under lock, then **`runReindexTargets`** for each id (Firecrawl vs raw fetch per env).
- [REPO] **`trask-indexer drain-queue`** (`scripts/trask_indexer_drain_queue.sh`) — same queue file/lock, drains into **Chroma** via Crawl4AI batch crawl ([trask-indexed-stack-runbook.md](../50-execution/trask-indexed-stack-runbook.md)).
- [REPO] **`trask-indexer run-queue-worker [pollMs]`** (`scripts/trask_indexer_run_queue_worker.sh`) — continuous Chroma drain loop; poll interval clamped **1000–300000** ms (default **15000**).
- [REPO] **`run-queue-worker [pollMs]`** — loop **`drain-queue`** then sleep; **`pollMs`** clamped **1000–300000** (default **15000**).

# What reindex does **not** cover

- [SYNTH] **`import-discord-export`** writes Discord chunks directly; it does not use this queue unless a separate workflow queues catalog sources afterward.
- [SYNTH] Queue entries are **source ids** (catalog), not per-URL jobs; scraping scope is defined by ingest fetch logic, not this file.

# Related

- [trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md) — `createChunkSearchProvider` + catalog wiring.
- [trask-configuration-env-map.md](../50-execution/trask-configuration-env-map.md) — **`INGEST_STATE_DIR`**.
- [trask-research-troubleshooting.md](../50-execution/trask-research-troubleshooting.md) — state path mismatches.
- [discord-text-ingestion-runbook.md](../50-execution/discord-text-ingestion-runbook.md) — Discord chunks vs catalog refresh.
