---
status: active
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-06-04-009-feat-trask-discord-playwright-holocron-e2e-plan.md
date: 2026-06-04
---

# Plan: Trask e2e ladder closeout (Playwright + docs + CI)

## Problem (remaining)

Plan 009 landed Discord Playwright harness and Holocron citation assertions, but:

1. `AGENTS.md` does not document `trask:e2e:discord:playwright` / `trask:e2e:playwright`.
2. Full Holocron Playwright matrix (6 tests) not re-run after citation assertion changes on PR #98.
3. PR #98 CI must go green with new Build job Discord Playwright step.

## Inferred Intent

- **Direct ask:** Complete Trask Q&A e2e story — Playwright for Holocron + Discord, browser validation.
- **Adjacent impact:** Agent runbooks, PR merge readiness, validation-ladder accuracy.
- **Cohesive scope:** Doc drift fix, full local Holocron Playwright pass, Discord offline Playwright + import-smoke, CI watch.
- **Risks if partial:** Agents miss new scripts; merge with unverified Holocron 6-test matrix.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | `AGENTS.md` documents `trask:e2e:discord:playwright`, `trask:e2e:playwright`, harness port 4012 |
| R2 | `pnpm trask:e2e:discord:playwright` passes locally |
| R3 | `HOLOCRON_REUSE_SERVER=1 pnpm holocron:e2e:playwright` — 6/6 pass on live stack |
| R4 | PR #98 Build & Test + Holocron Playwright jobs green |
| R5 | Browser smoke: one Holocron expert query on `:4010` (agent-browser) |

## Implementation units

### U1 — Agent docs

- **Files:** `AGENTS.md` (Trask Discord / Holocron e2e sections)

### U2 — Local Playwright verification

- Discord: `pnpm trask:e2e:discord:playwright`
- Holocron: stack on `:4010` → `HOLOCRON_REUSE_SERVER=1 pnpm holocron:e2e:playwright`

### U3 — CI + PR

- Watch `gh pr checks 98`; autofix if Build job fails on Discord Playwright install/runtime

## Deferred

- Live `pnpm verify:trask-discord` (needs bot token in env)
- discord.com headed Playwright (operator-only)
