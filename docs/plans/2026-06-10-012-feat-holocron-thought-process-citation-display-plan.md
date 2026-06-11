---
status: completed
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-06-05-011-fix-holocron-docker-trask-subpath-plan.md
date: 2026-06-10
---

# Plan: Holocron thought-process citation display

## Problem

Sources panel shows `README.md#L1` via `webCitationDisplayLabel`, but expanded **Thought process** steps still surface raw `githubusercontent` path noise in `step.detail` and full URL link text in diagnostics.

## Inferred Intent

- **Direct ask:** Continue Trask/Holocron e2e + browser validation; polish citation UX consistently.
- **Adjacent impact:** Research trace readability, Playwright contracts, PR #98 merge readiness.
- **Cohesive scope:** Sanitize trace detail text; label diagnostic URLs with same permalink helper as Sources.
- **Risks if partial:** Users see polished Sources but messy trace — undermines citation fix.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | `sanitizeResearchTraceText` / `formatTraceUrlLabel` in `answer-presentation.ts` |
| R2 | `Message.tsx` thought-process `detail` + diagnostic URL labels use helpers |
| R3 | Unit test for trace URL label |
| R4 | Local Playwright + agent-browser smoke on `:4010` after stack restart |

## Deferred

- Live `pnpm verify:trask-discord` (needs bot token)
- discord.com headed Playwright
