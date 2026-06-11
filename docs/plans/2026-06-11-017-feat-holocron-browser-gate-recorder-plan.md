---
status: completed
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-06-11-016-feat-trask-e2e-ladder-unification-plan.md
date: 2026-06-11
---

# Plan: Holocron live browser gate recorder

## Inferred Intent

- **Direct ask:** Playwright + browser validation for all five Holocron expert queries on `:4010`.
- **Adjacent impact:** Agent runbooks need a fast evidence artifact without full `trask:gate` + e2e webServer boot.
- **Cohesive scope:** `pnpm holocron:browser-gate` against live stack; writes `docs/evidence/holocron-browser-gate-latest.md`.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | `scripts/record_holocron_browser_gate.mjs` — five verification queries, citation/githubusercontent checks |
| R2 | `pnpm holocron:browser-gate` npm script |
| R3 | 5/5 pass with stack on `:4010` |

## Deferred

- CI job for browser-gate (redundant with holocron-playwright-e2e)
- Public Pages QA
