---
status: completed
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-05-24-113-holocron-failure-path-e2e-plan.md
date: 2026-06-10
---

# Plan: Wire Holocron failure-path Playwright into CI

## Inferred Intent

- **Direct ask:** Trask Q&A vertical slice with Playwright on Discord harness + Holocron happy and failure paths.
- **Adjacent impact:** `groundingStatus: failed` UX, liveTrace diagnostics, CI ladder completeness.
- **Cohesive scope:** Restore `playwright.failure.config.ts`, npm scripts, CI step; keep happy path on indexed stack.
- **Risks if partial:** Failure UX regresses silently while five-query happy path stays green.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | `playwright.failure.config.ts` with `HOLOCRON_E2E_FAILURE_MODE=1` webServer env |
| R2 | `pnpm holocron:e2e:playwright:failure` and `trask:e2e:playwright:full` |
| R3 | CI holocron job runs failure spec after happy path |
| R4 | Local `pnpm holocron:e2e:playwright:failure` passes |

## Deferred

- discord.com headed Playwright
- Public Pages QA
