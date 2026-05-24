---
title: "feat: Trask Crawl4AI RAG ops closure (queue bridge + runbook)"
type: feat
status: active
date: 2026-05-23
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
---

# Trask Crawl4AI RAG Ops Closure

## Summary

Close the remaining production-ops gaps from the Crawl4AI + Chroma migration: drain the shared `reindex-queue.json` into Chroma via Crawl4AI, document the indexed stack for operators, and remove stale `TRASK_RESEARCH_BACKEND` references now that the Python retrieve bridge is always-on.

---

## Problem Frame

The indexed research path is live (indexer, Worker, Python subprocess, grounded compose, Holocron e2e in CI). Operators still cannot refresh catalog sources into **Chroma** through the existing `/queue-reindex` and ingest-worker queue contract — only the legacy Firecrawl/FileChunkStore path drains the queue. (see origin: `docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md`)

---

## Assumptions

*This plan was authored without synchronous user confirmation. The items below are agent inferences that fill gaps in the input — un-validated bets that should be reviewed before implementation proceeds.*

- The Python subprocess + `scripts/trask_web_research.py` path is the permanent research backend; formal `TRASK_RESEARCH_BACKEND` Node flag is **not** needed for v1 closure.
- Queue drain reuses existing lock semantics from `packages/retrieval` by reading/dequeuing atomically in Python mirroring ingest-worker behavior.
- v1 drain scope is **catalog home URLs per source id** via existing `batch_crawl.run_batch_crawl`, not per-URL Firecrawl depth.

---

## Requirements

- R1. `trask-indexer drain-queue` reads `INGEST_STATE_DIR/reindex-queue.json`, respects lock file, crawls queued source ids into Chroma
- R2. Operator runbook documents bootstrap, live stack, queue drain, backup, and health checks
- R3. Stale `TRASK_RESEARCH_BACKEND=indexed` docs updated to reflect always-on Python bridge
- R4. `scripts/trask_index_golden_corpus.sh` wraps batch crawl for QA seeding beyond fixtures

---

## Scope Boundaries

- Node `ResearchBackend` / `indexed-research-backend.ts` abstraction
- Replacing ingest-worker Firecrawl path entirely
- Production Discord sync interval deployment (separate ops task)
- Chroma nightly backup automation (document manual backup only)

### Deferred to Follow-Up Work

- CI Chroma artifact cache for e2e flakiness
- `FileChunkStore` merge into Q&A path
- systemd/cron packaging for VPS (runbook documents commands only)

---

## Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Python queue drain in `trask_indexer/worker.py` | Reuses `batch_crawl`; same VPS as indexer |
| Mirror lock contract from `packages/retrieval` | Avoid double-drain races with ingest-worker |
| Doc-only decommission of `TRASK_RESEARCH_BACKEND` | Flag never shipped; Python path is production default |

---

## Implementation Units

- U1. **Reindex queue bridge**

**Goal:** F3/AE-4 — operator `/queue-reindex` updates Chroma corpus.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Create: `infra/trask-indexer/trask_indexer/worker.py`
- Modify: `infra/trask-indexer/trask_indexer/cli.py`
- Create: `scripts/trask_indexer_drain_queue.sh`
- Test: `infra/trask-indexer/tests/test_worker.py`

**Approach:**
- Load queue JSON from `INGEST_STATE_DIR/reindex-queue.json`
- Acquire exclusive lock on `reindex-queue.lock` (same stale/timeout semantics as Node)
- Dequeue all source ids atomically, call `run_batch_crawl(source_ids=...)`
- CLI subcommand `drain-queue` with optional `--dry-run`

**Test scenarios:**
- Happy path: enqueue one source id → drain → queue empty, batch crawl invoked
- Edge case: empty queue → exit 0 with message
- Error path: lock held → non-zero exit with actionable stderr

**Verification:**
- Manual: queue a source via ingest-worker CLI, run drain, retrieve API returns new passages

---

- U2. **Operator runbook**

**Goal:** R2 — operators can reproduce indexed stack without reading scattered docs.

**Requirements:** R2

**Dependencies:** U1

**Files:**
- Create: `docs/knowledgebase/50-execution/trask-indexed-stack-runbook.md`
- Modify: `infra/trask-indexer/README.md`
- Modify: `docs/knowledgebase/README.md` (link)

**Approach:**
- Document bootstrap, `trask_live_stack.sh`, seed/QA, queue drain, batch crawl, backup/restore, health URLs

**Test scenarios:**
- Test expectation: none — documentation alignment

**Verification:**
- Runbook commands match actual scripts in repo

---

- U3. **Doc drift: research backend references**

**Goal:** R3 — remove misleading `TRASK_RESEARCH_BACKEND=indexed` guidance.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `infra/trask-indexer/README.md`
- Modify: `docs/knowledgebase/50-execution/trask-configuration-env-map.md`
- Modify: `docs/brainstorms/trask-crawl4ai-rag-requirements.md` (success criteria note)

**Approach:**
- Replace flag references with `TRASK_INDEXER_BASE_URL` + Python subprocess path description

**Verification:**
- `pnpm trask:config-drift` passes

---

- U4. **Golden corpus crawl script**

**Goal:** R4 — operator one-liner for full allowlist seed crawl.

**Requirements:** R4

**Dependencies:** None (uses existing `crawl-seeds`)

**Files:**
- Create: `scripts/trask_index_golden_corpus.sh`

**Approach:**
- Thin wrapper around `trask_crawl_catalog.sh` with documented depth/limit defaults for QA

**Verification:**
- Script exits 0 with `--dry-run`

---

## System-Wide Impact

- **Interaction graph:** Discord `/queue-reindex` and ingest-worker CLI unchanged at enqueue; new drain path targets Chroma instead of FileChunkStore when operator runs indexer drain.
- **Unchanged invariants:** Holocron e2e contract, retrieve Worker URL, grounded compose path.

---

## Sources & References

- **Origin plan:** `docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md`
- **Queue contract:** `docs/knowledgebase/10-architecture-runtime/trask-reindex-queue-contract.md`
- **Batch crawl:** `infra/trask-indexer/trask_indexer/batch_crawl.py`
- **Solutions:** `docs/solutions/tooling-decisions/trask-crawl4ai-research-cutover-2026-05-19.md`
