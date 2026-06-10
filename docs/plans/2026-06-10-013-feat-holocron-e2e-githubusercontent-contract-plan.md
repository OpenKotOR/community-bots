---
status: completed
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-06-10-012-feat-holocron-thought-process-citation-display-plan.md
date: 2026-06-10
---

# Plan: Holocron Playwright githubusercontent contract

## Inferred Intent

- **Direct ask:** Continue Trask Q&A vertical slice with Playwright + browser gates on Holocron and Discord.
- **Adjacent impact:** Answer sanitization (012) must be enforced in CI e2e, not only unit tests and manual browser.
- **Cohesive scope:** Extend `holocron-research.spec.ts` to reject `githubusercontent` in answer body and expanded thought-process region; run full Playwright ladder + live Discord when token present.
- **Risks if partial:** Regression reintroduces raw CDN paths in UI while Sources cards stay polished.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | Each research query: `bodyText` must not match `/githubusercontent\.com/i` |
| R2 | Expand thought process; region text must not match `/githubusercontent\.com/i` |
| R3 | `pnpm holocron:e2e:playwright` passes locally with stack |
| R4 | `pnpm trask:e2e:playwright` (Discord harness + Holocron) passes |
| R5 | Optional: `pnpm verify:trask-discord` live gate when token available |

## Deferred

- Public Pages QA after deploy
- discord.com headed Playwright
