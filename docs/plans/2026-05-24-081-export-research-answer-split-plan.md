---
title: "feat(trask): export research-answer-split from package index"
type: feat
status: completed
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md
---

# Export research-answer-split From Package Index

## Summary

`scripts/trask_faithfulness_eval.mjs` deep-imports `packages/trask/dist/research-answer-split.js`. After the citation module refactor, expose `splitResearchAnswer` and `syncSourcesSectionToApproved` from `@openkotor/trask` and switch the faithfulness script to the package entry. Keep `citation-markers.ts` internal (no package export).

## Requirements

- R1. `packages/trask/src/index.ts` re-exports `research-answer-split.js`.
- R2. `scripts/trask_faithfulness_eval.mjs` imports `splitResearchAnswer` and `citationIndicesInText` from `@openkotor/trask`; root `package.json` lists `@openkotor/trask` as a devDependency for script resolution.
- R3. Module architecture doc notes public vs internal modules; `last_gate` → `pnpm trask:gate`.
- R4. `pnpm trask:gate` exits 0 (faithfulness + composite_score **165**).

## Scope Boundaries

- No export of `citation-markers.ts` from package index.
- No live Discord/Holocron runs.

## Verification

```bash
pnpm trask:gate
```
