---
title: "feat(trask): liveTrace timeout timing diagnostics (Plan 006 U4)"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-006-feat-trask-research-quality-bar-v1-plan.md
---

# liveTrace timeout timing diagnostics

## Inferred intent

- **Direct ask:** Surface where research time went on failure (R5) — `elapsed_ms`, named limit, and phase in `liveTrace`.
- **Adjacent impact:** Python `research_information.retrieve_elapsed_ms`; Holocron e2e trace shape; stderr `trask_research_trace` parity.
- **Cohesive scope:** U4 only — no env default retunes, no Holocron UI chrome.
- **Risks if partial:** Operators still cannot distinguish gather vs compose timeouts from trace alone.

## Requirements

- **R1.** On gather timeout, failure `liveTrace` row includes `diag.elapsed_ms`, `diag.timeout_limit_ms`, `diag.timeout_phase: "gather"`.
- **R2.** On compose/rewrite timeout, same with `timeout_phase: "compose"` and compose budget.
- **R3.** Happy-path retrieve summary includes `diag.retrieve_elapsed_ms` from Python payload when present.
- **R4.** Unit tests in `research-wizard.test.ts`; `pnpm trask:gate:ci` green.

## Verification

```bash
pnpm --filter @openkotor/trask build
node --test packages/trask/dist/research-wizard.test.js
pnpm trask:gate:ci
```
