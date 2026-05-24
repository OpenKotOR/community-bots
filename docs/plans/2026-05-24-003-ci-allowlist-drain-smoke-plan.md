---
title: "ci: Export allowlist and smoke drain-queue in CI"
type: chore
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
---

# CI — Allowlist Export + Drain-Queue Smoke

## Summary

Export the Trask allowlist catalog in CI before indexer tests and run `drain-queue --dry-run` as a CLI smoke gate so queue worker paths fail in CI when allowlist or CLI wiring breaks.

---

## Problem Frame

Indexer pytest covers worker logic in isolation, but CI never exports `data/trask-indexer/allowlist.json` or exercises the `drain-queue` CLI entrypoint that operators use after `/queue-reindex`.

---

## Requirements

- R1. CI runs `node scripts/export_trask_allowlist_catalog.mjs` after TypeScript build, before indexer pytest
- R2. CI runs `drain-queue --dry-run` smoke (empty queue → exit 0)
- R3. Parent crawl4ai plan living delta updated for PR #9 landed work

---

## Scope Boundaries

- Live crawl in CI
- Discord sync production deploy

---

## Implementation Units

- U1. CI steps in `.github/workflows/ci.yml`
- U2. Living delta in `docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md`

**Verification:** `node scripts/export_trask_allowlist_catalog.mjs && bash scripts/trask_indexer_drain_queue.sh --dry-run`

---
