---
title: "feat: Trask indexer run-queue-worker for scheduled Chroma reindex"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
---

# Trask Indexer Run Queue Worker

## Summary

Add a long-running `run-queue-worker` command to `trask-indexer` that polls `INGEST_STATE_DIR/reindex-queue.json` and drains queued catalog source ids into Chroma — mirroring ingest-worker's queue worker but on the Crawl4AI path.

---

## Problem Frame

PR #9 landed `drain-queue` as a one-shot operator command. Production still needs a **scheduled / continuous** drain so `/queue-reindex` jobs refresh Chroma without manual intervention. (see origin plan delta: "Web corpus background reindex worker not scheduled on VPS")

---

## Assumptions

- Poll interval semantics match ingest-worker: default 15000ms, clamp 1000–300000.
- Worker runs until SIGINT/SIGTERM; no daemonization in v1 (systemd/cron documented in runbook only).

---

## Requirements

- R1. `trask-indexer run-queue-worker [pollMs]` loops drain → sleep
- R2. Shell wrapper for operators
- R3. Runbook + queue contract docs updated
- R4. Unit tests for poll clamp and one drain cycle

---

## Scope Boundaries

- systemd unit files or VPS cron packaging
- Replacing ingest-worker queue worker
- Discord sync production interval

---

## Implementation Units

- U1. **`run_queue_worker` in worker.py + CLI**

**Files:** `infra/trask-indexer/trask_indexer/worker.py`, `cli.py`, `tests/test_worker.py`

**Approach:** Parse pollMs like ingest-worker; infinite loop calling `drain_reindex_queue(dry_run=False)` then sleep.

- U2. **Shell wrapper + docs**

**Files:** `scripts/trask_indexer_run_queue_worker.sh`, runbook, reindex-queue-contract

**Verification:** `python -m pytest infra/trask-indexer/tests/test_worker.py`; dry-run drain still works

---

## Sources & References

- `apps/ingest-worker/src/main.ts` — `run-queue-worker` pattern
- `docs/plans/2026-05-23-011-feat-trask-crawl4ai-rag-ops-closure-plan.md`
