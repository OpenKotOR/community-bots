---
status: completed
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-06-11-017-feat-holocron-browser-gate-recorder-plan.md
date: 2026-06-11
---

# Plan: Trask QA surfaces orchestrator

## Inferred Intent

- **Direct ask:** One command for agents validating Discord + Holocron without hunting npm scripts.
- **Adjacent impact:** Failure e2e must not run against a healthy indexer stack; order matters.
- **Cohesive scope:** `scripts/trask_qa_surfaces.sh` + `pnpm trask:qa:surfaces`.

## Flow

1. Discord Playwright (offline :4012)
2. Stack health gate (`trask_indexed_stack_health.sh --check-http`)
3. Holocron happy Playwright (`HOLOCRON_REUSE_SERVER=1`)
4. `holocron:browser-gate` → evidence markdown
5. Holocron failure Playwright (kills :4010; run last — restart stack afterward)

## Deferred

- Live `verify:trask-discord` (bot token; run separately)
- Public Pages QA
