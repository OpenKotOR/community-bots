---
title: "feat(trask): AE3 trask_research_trace failure-class gate smoke"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-006-feat-trask-research-quality-bar-v1-plan.md
---

# AE3 research trace failure-class gate smoke

## Inferred intent

- **Direct ask:** Automate Plan 006 U2/AE3 — operators can classify retrieve vs verify vs timeout failures from `trask_research_trace` JSON without Holocron.
- **Adjacent impact:** `trask:gate` import smoke (same pattern as #82 Discord footer); `docs/trask-ops.md` grep examples.
- **Cohesive scope:** Gate smoke + unit tests only; no new UI or live subprocess in CI.
- **Risks if partial:** Trace shape regresses while `trask:gate` still passes.

## Requirements

- **R1.** Shared `scripts/lib/trask_research_trace_assert.mjs` validates `trask_research_trace` JSON carries classifiable `diag` keys.
- **R2.** `trask_smoke_package_imports.mjs` calls the assert (runs under `pnpm trask:gate:ci`).
- **R3.** Failure classes covered: `index_miss`, `rejected_urls`, `timeout_phase` (gather|compose).
- **R4.** `pnpm trask:gate:ci` and wizard unit tests pass.

## Verification

```bash
pnpm trask:gate:ci
node --test packages/trask/dist/research-wizard.test.js
```
