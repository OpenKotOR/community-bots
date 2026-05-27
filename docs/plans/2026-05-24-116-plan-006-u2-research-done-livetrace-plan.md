---
title: "feat(trask): Plan 006 U2 v1.1 research_done liveTrace row"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-006-feat-trask-research-quality-bar-v1-plan.md
---

# Plan 006 U2 v1.1 — research_done → liveTrace

## Requirements

- **R1.** After successful Python research, Holocron `liveTrace` includes one **`research_done`** gather row with passages, URL count, `index_miss`, and `rejected_urls` in `diag`.
- **R2.** Python stderr emits matching `trask_research_trace` JSON for operator grep (AE3) without opening Holocron.
- **R3.** Unit test + `trask:gate` AE3 assert covers `research_done` diag keys.
- **R4.** Plan 006 deferred note updated when shipped.

## Files

- Modify: `packages/trask/src/research-wizard.ts`
- Modify: `scripts/trask_web_research.py`
- Modify: `packages/trask/src/research-wizard.test.ts`
- Modify: `scripts/lib/trask_research_trace_assert.mjs`
- Modify: `docs/plans/2026-05-19-006-feat-trask-research-quality-bar-v1-plan.md`

## Test scenarios

- Happy payload: `emitResearchDoneSummary` adds gather row with `diag.research_done === true`, `passages`, `urls`, `index_miss`.
- AE3 gate: captured trace line classifies index_miss from `research_done` row.

## Verification

```bash
pnpm build
node --test packages/trask/dist/research-wizard.test.js
pnpm trask:gate:ci
```
