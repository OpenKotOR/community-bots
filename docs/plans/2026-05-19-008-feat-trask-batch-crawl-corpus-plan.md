---
title: "feat: Trask batch crawl-seeds + heading-aware chunking"
type: feat
status: completed
date: 2026-05-19
origin: docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md
predecessor: docs/plans/2026-05-19-007-feat-trask-rag-incremental-hardening-plan.md
---

# Trask batch crawl-seeds + heading-aware chunking

## Summary

Land **U5** from plan 007: operator **`trask-indexer crawl-seeds`** to batch-index allowlisted catalog URLs into Chroma (index-first corpus). Add **minimal U6**: heading-aware markdown chunking before character windows. Wire a **`scripts/trask_crawl_catalog.sh`** wrapper for operators. HF deploy parity (U7) stays deferred.

---

## Problem Frame

Query-time live crawl is recovery-only and capped; expert queries still miss when the batch corpus is thin. Operators need a one-shot crawl over `data/trask-indexer/allowlist.json` seeds without manual per-URL scripts.

---

## Requirements

- R1. Index-first batch crawl (origin)
- R3. Heading-aware chunking at ingest (origin, minimal slice)
- R14. Local repro documented (origin)

**Origin flows:** F2 recovery remains; F1 improves after batch crawl

---

## Scope Boundaries

- True BM25 / Chroma sparse index (full U6 — defer)
- Cross-encoder rerank (defer)
- HF supervisor + baked Chroma (U7 — defer)
- Restoring deleted Trask unit tests

### Deferred to Follow-Up Work

- **U7 HF deploy:** supervisor entrypoint + baked Chroma volume in `infra/trask-http-public/`

---

## Key Technical Decisions

- **Reuse live crawl primitives:** `crawl_url`, `chunk_markdown`, `upsert_chunks` — same code path as `live_index.py`.
- **Heading chunking:** Split on markdown `##` / `#` headings, then apply char windows within each section — preserves tool-name context better than flat windows alone.
- **CLI flags:** `--limit`, `--source-id` (repeatable), `--dry-run`, `--max-urls-per-source` default 1 (home URL only).

---

## Implementation Units

- U1. **Heading-aware `chunk_markdown`**

**Goal:** Chunk by section headings before char overlap.

**Requirements:** R3

**Dependencies:** None

**Files:**
- Modify: `infra/trask-indexer/trask_indexer/chunk.py`
- Test: `infra/trask-indexer/tests/test_chunk.py`

**Test scenarios:**
- Happy path: markdown with two `##` sections yields chunks that do not span unrelated headings
- Edge case: empty markdown → empty list

**Verification:** `python -m pytest infra/trask-indexer/tests/test_chunk.py` or `node`-less pytest in indexer venv

---

- U2. **`trask-indexer crawl-seeds` command**

**Goal:** Batch crawl all (or filtered) allowlist sources into Chroma.

**Requirements:** R1, AE3

**Dependencies:** U1

**Files:**
- Modify: `infra/trask-indexer/trask_indexer/cli.py`
- Create: `infra/trask-indexer/trask_indexer/batch_crawl.py`
- Create: `scripts/trask_crawl_catalog.sh`
- Modify: `docs/trask-research-backends.md`, `docs/solutions/tooling-decisions/trask-crawl4ai-research-cutover-2026-05-19.md`

**Approach:** Extract shared `index_url(url, source_id)` from live_index pattern; CLI prints progress JSON lines for operators.

**Test scenarios:**
- Happy path: dry-run lists N seed URLs without network
- Edge case: missing allowlist.json exits non-zero with clear message

**Verification:** `trask-indexer crawl-seeds --dry-run`; after real crawl, golden CLI query shows `index_miss=false` more often

---

- U3. **Mark plan 007 U2/U4 verification notes**

**Goal:** Update plan 007 status footer only if needed after U2 lands (no plan body edits during ce-work except status).

**Requirements:** R4, R16

**Dependencies:** U2

**Verification:** `pnpm trask:faithfulness-eval` still passes

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Crawl4AI needs browser deps on operator host | Document in script header; reuse bootstrap_trask_indexer.sh |
| Long crawl runtime | `--limit` anders; idempotent upsert by content hash |

---

## Sources & References

- **Origin:** [docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md](../brainstorms/trask-self-hosted-research-pipeline-requirements.md)
- **Predecessor:** [docs/plans/2026-05-19-007-feat-trask-rag-incremental-hardening-plan.md](./2026-05-19-007-feat-trask-rag-incremental-hardening-plan.md)
