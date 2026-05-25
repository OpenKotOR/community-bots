---
title: "feat(verify): shared QA stack bootstrap for verify:trask-discord"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-094-verify-trask-cli-stack-bootstrap-plan.md
---

# verify:trask-discord Indexed Stack Bootstrap

## Summary

CLI verify (#67) and Holocron e2e (#66) auto-bootstrap indexer+Worker. Discord live gate still required manual stack. Wire `verify_trask_discord_live.mjs` to `trask_qa_stack_bootstrap.mjs`, dedupe Holocron webServer env via `holocron-e2e-webserver.mjs`, sync arc **#33–#68**.

## Requirements

- R1. `verify_trask_discord_live.mjs` calls `bootstrapTraskIndexedStack` after `loadEnvFiles`.
- R2. `holocron-e2e-webserver.mjs` applies shared bootstrap + holocron-only env; shell wrapper execs it.
- R3. `trask_qa_stack_bootstrap.mjs` documents three consumers.
- R4. Docs arc **#33–#68**; AGENTS Discord section; runbook + validation-ladder.
- R5. `pnpm trask:gate` and `verify_trask_discord_live.mjs --skip-url-check` exit 0.

## Verification

```bash
pnpm trask:gate
node --import tsx/esm scripts/verify_trask_discord_live.mjs --skip-url-check
```
