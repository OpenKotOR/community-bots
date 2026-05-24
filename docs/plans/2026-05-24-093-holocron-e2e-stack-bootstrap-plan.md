---
title: "feat(holocron): bootstrap indexed stack for local e2e"
type: feat
status: completed
date: 2026-05-24
origin: AGENTS.md Holocron mandatory verification
---

# Holocron E2E Stack Bootstrap (CI Parity)

## Summary

Playwright `webServer` only started `trask-http-server`; CI starts indexer + retrieve Worker and sets `TRASK_QA_GROUNDING=1` for keyless compose. Add `scripts/ensure_trask_indexed_stack_for_e2e.sh` and `scripts/holocron-e2e-webserver.sh`; point Playwright at the wrapper. Export CI-parity env on `holocron:e2e:playwright`. Sync KB arc refs to **#33–#65**.

## Requirements

- R1. `ensure_trask_indexed_stack_for_e2e.sh` starts indexer **8790** + Worker **8787** when unhealthy; seeds Chroma if missing; does not bind **4010**.
- R2. `holocron-e2e-webserver.sh` sets `TRASK_QA_GROUNDING`, `TRASK_LLM_PROFILE=free`, `TRASK_INDEXER_BASE_URL`, `TRASK_WEB_RESEARCH_PYTHON`; then runs live server.
- R3. `playwright.config.ts` webServer uses `holocron-e2e-webserver.sh`.
- R4. `pnpm trask:gate` exits 0; attempt `pnpm holocron:e2e:playwright` when stack boots.
- R5. Docs arc **#33–#65** in closeout/KB where stale.

## Scope Boundaries

- Does not replace full `trask_live_stack.sh` for manual dev.

## Verification

```bash
pnpm trask:gate
pnpm holocron:e2e:playwright
```
