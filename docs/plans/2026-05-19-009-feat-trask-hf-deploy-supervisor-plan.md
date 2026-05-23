---
title: "feat: Trask HF Docker supervisor (indexer + HTTP)"
type: feat
status: completed
date: 2026-05-19
origin: docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md
predecessor: docs/plans/2026-05-19-008-feat-trask-batch-crawl-corpus-plan.md
---

# Trask HF Docker supervisor (indexer + HTTP)

## Summary

Land **U7** from plan 007: public **`infra/trask-http-public`** image runs **both** `trask-indexer serve` and `trask-http-server` via a supervisor entrypoint, with indexer bootstrap + QA Chroma seed at build time. Close plan 007 status. No BM25 rerank or test suite restore in this slice.

---

## Problem Frame

HF Docker currently boots HTTP only while `TRASK_INDEXER_BASE_URL` points at :8790 — retrieve fails in-container without a separate indexer process. Public Holocron needs a single-container repro path.

---

## Requirements

- R1. Index-first retrieve in public deploy (origin)
- R14. Operator repro via documented Docker path (origin)
- R16. Faithfulness eval unchanged (origin)

**Origin flows:** F1 happy path in HF Space

---

## Scope Boundaries

- Cloudflare Worker in Docker (HF uses direct indexer :8790 — documented)
- Full holocron e2e in CI for this PR (manual/agent-browser smoke only)
- BM25 sparse index (defer)
- Restoring Trask unit tests

### Deferred to Follow-Up Work

- **Worker sidecar** for HF if retrieve contract must match local :8787 exactly
- **Baked full catalog crawl** at image build (operator runs `trask_crawl_catalog.sh` post-deploy)

---

## Key Technical Decisions

- **Supervisor:** bash entrypoint starts indexer in background, health-waits, then execs HTTP server as PID 1 child with trap cleanup.
- **Build:** run `bootstrap_trask_indexer.sh` + `trask_index_seed_for_qa.sh` during Docker build so Chroma has golden-fixture corpus.
- **Env:** keep `TRASK_INDEXER_BASE_URL=http://127.0.0.1:8790` in image (no Worker in container).

---

## Implementation Units

- U1. **Supervisor entrypoint script**

**Goal:** Start indexer then HTTP in one container.

**Requirements:** R1, R14

**Files:**
- Create: `infra/trask-http-public/docker-entrypoint.sh`
- Modify: `infra/trask-http-public/Dockerfile` (CMD → entrypoint)

**Verification:** `docker build` dry logic; entrypoint health-wait loops match `trask_live_stack.sh` pattern

---

- U2. **Indexer bootstrap + QA seed in Docker build**

**Goal:** Image includes `.venv-trask-indexer`, Chroma data with golden fixtures.

**Requirements:** R1

**Files:**
- Modify: `infra/trask-http-public/Dockerfile`
- Modify: `infra/trask-http-public/README.md`

**Verification:** Built image has `data/trask-indexer/chroma` and indexer health responds

---

- U3. **Close plan 007**

**Goal:** Mark plan 007 `status: completed` (U5/U6 partial landed in 008).

**Files:** `docs/plans/2026-05-19-007-feat-trask-rag-incremental-hardening-plan.md`

---

## Sources & References

- **Origin:** [docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md](../brainstorms/trask-self-hosted-research-pipeline-requirements.md)
- **Predecessor:** [docs/plans/2026-05-19-008-feat-trask-batch-crawl-corpus-plan.md](./2026-05-19-008-feat-trask-batch-crawl-corpus-plan.md)
