---
title: "fix: Resolve PR #8 merge conflicts with main"
type: fix
status: completed
date: 2026-05-19
origin: docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md
predecessor: docs/plans/2026-05-19-010-feat-trask-docker-ci-holocron-e2e-plan.md
---

# Resolve PR #8 merge conflicts with main

## Summary

PR #8 is **mergeable: CONFLICTING**. Merge `origin/main`, resolve conflicts preserving index-first RAG branch work (sufficiency gate, crawl-seeds, HF supervisor, Docker CI) while absorbing non-conflicting main updates.

---

## Requirements

- R14. Branch merges cleanly into main
- R16. Post-merge gates: build, faithfulness eval, holocron e2e

---

## Scope Boundaries

- Re-adding deleted Trask unit tests (keep deleted per product policy)
- New features beyond conflict resolution

---

## Implementation Units

- U1. **Merge origin/main and resolve conflicts**

**Goal:** Clean merge commit; `git diff` shows intentional union of both sides.

**Resolution policy:**
- **Keep deleted** `packages/trask-http/src/router.test.ts`, `packages/trask/src/discord-reply-format.test.ts`
- **Prefer branch** for trask RAG code (grounded-evidence, research-wizard, indexer batch_crawl, HF entrypoint)
- **Union** workflow path filters and env docs where both added paths

**Verification:** `pnpm build`, `pnpm trask:faithfulness-eval`

---

- U2. **Re-run holocron e2e smoke**

**Verification:** `pnpm holocron:e2e` with live stack

---
