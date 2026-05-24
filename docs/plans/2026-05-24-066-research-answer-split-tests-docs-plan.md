---
title: "test+docs: research-answer-split unit tests and KB sync"
type: test
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-065-extract-research-answer-split-plan.md
---

# Research-Answer-Split Tests and Docs Sync

## Summary

After PR #38 extracted `research-answer-split.ts`, add focused unit tests for `splitResearchAnswer` and `syncSourcesSectionToApproved`, and sync KB/solutions docs so the module map and gate history reflect the refactor.

## Requirements

- R1. New `packages/trask/src/research-answer-split.test.ts` covering: no Sources block, `Sources` / `# Sources` / `References` headings, body newline collapse, `syncSourcesSectionToApproved` rewrite and empty-sources body-only path.
- R2. Update `docs/knowledgebase/10-architecture-runtime/trask-citation-display-contract.md` module map: add `research-answer-split.ts`; narrow `discord-reply-format.ts` responsibility.
- R3. Update `docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md` history for PR #38 (composite_score **165** unchanged).
- R4. `pnpm build && pnpm trask:optimize-measure` → composite_score **165**.

## Scope Boundaries

- Moving compose tests out of `grounded-evidence.test.ts`.
- Breaking `discord-reply-format` → `grounded-evidence` import for query anchors.

## Verification

`pnpm build && node --test packages/trask/dist/research-answer-split.test.js && pnpm trask:optimize-measure`
