---
title: "ci: Wire Trask indexer pytest into main CI job"
type: chore
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
---

# CI — Trask Indexer Python Tests

## Summary

Run `infra/trask-indexer/tests/` in the main CI job after bootstrap so queue worker and batch crawl regressions are caught before merge.

---

## Problem Frame

PR #9 added `worker.py`, `drain-queue`, and `run-queue-worker` with 19+ pytest cases, but CI only runs Node unit tests and Holocron e2e — Python indexer tests are local-only.

---

## Requirements

- R1. CI runs `pytest infra/trask-indexer/tests/` after `bootstrap_trask_indexer.sh`
- R2. Root `pnpm trask:indexer:test` script for local parity

---

## Scope Boundaries

- New GitHub workflow file
- Holocron e2e changes
- crawl4ai-setup in CI (tests use mocks/fixtures)

---

## Implementation Units

- U1. Add `trask:indexer:test` to root `package.json`
- U2. Add CI step in `.github/workflows/ci.yml` after bootstrap

**Verification:** `pnpm trask:indexer:test` exits 0 locally

---

## Sources & References

- `scripts/bootstrap_trask_indexer.sh` — installs `[dev]` with pytest
- `infra/trask-indexer/tests/test_worker.py`
