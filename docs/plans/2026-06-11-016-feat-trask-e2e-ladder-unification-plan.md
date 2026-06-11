---
status: completed
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-06-10-015-feat-holocron-failure-playwright-wireup-plan.md
date: 2026-06-11
---

# Plan: Unify Trask Playwright e2e ladder

## Inferred Intent

- **Direct ask:** One coherent Playwright path for Discord + Holocron (happy + failure), aligned with CI and AGENTS.md.
- **Adjacent impact:** `holocron:e2e` must match what CI runs; Discord embed contract mirrors Holocron citation hygiene.
- **Cohesive scope:** `test:e2e:all`, `holocron:e2e` includes failure spec; Discord harness rejects `githubusercontent`.
- **Risks if partial:** Developers run `holocron:e2e` and miss failure-path regressions.

## Changes

| Item | Action |
|------|--------|
| `holocron-web` | `test:e2e:all` = happy + failure configs (one build) |
| Root `holocron:e2e` | Uses `test:e2e:all` after `trask:gate` |
| Discord audit + Playwright | Reject `githubusercontent` in embed descriptions |
