---
status: completed
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-06-11-018-feat-trask-qa-surfaces-orchestrator-plan.md
date: 2026-06-11
---

# Plan: Public Pages Holocron Playwright spot-check

## Inferred Intent

- **Direct ask:** Close the deferred public Holocron validation path with Playwright, not manual-only.
- **Adjacent impact:** Post-deploy smoke for `VITE_TRASK_API_BASE` + worker research backend.
- **Cohesive scope:** One query on `qa-webui` Pages URL; evidence markdown; optional npm script (not CI — network + live API).

## Requirements

| ID | Requirement | Status |
|----|-------------|--------|
| R1 | `scripts/record_holocron_public_pages_gate.mjs` | done |
| R2 | `pnpm holocron:public-gate` | done |
| R3 | Validation ladder §8/AGENTS cross-ref | done |
| R4 | API `/healthz` preflight (fail fast on upstream outage) | done |

## Evidence (2026-06-11)

- `pnpm holocron:public-gate` → **FAIL** — `trask-worker.bocloud.workers.dev` upstream `openkotor-holocron-trask-http.hf.space` **503** (Space in error). Restore HF Space or repoint `TRASK_RESEARCHWIZARD_BASE_URL` before public gate can pass.

## Deferred

- Full five-query public matrix (localhost/CI remains authoritative)
- discord.com headed Playwright
- CI job for public gate (blocked on stable public research backend)
