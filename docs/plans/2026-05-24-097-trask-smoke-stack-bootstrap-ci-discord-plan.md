---
title: "feat(trask): stack-bootstrap smoke + CI discord import smoke"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-096-trask-qa-stack-bootstrap-compound-plan.md
---

# Stack Bootstrap Smoke + CI Discord Import Smoke

## Summary

Add `pnpm trask:smoke:stack-bootstrap`, `verify:trask-discord:ci` (`--import-smoke`), sync arc **#33–#69**, and CONTRIBUTING/README/runbook links.

## Requirements

- R1. `scripts/smoke_trask_qa_stack_bootstrap.mjs` + package script.
- R2. `verify_trask_discord_live.mjs --import-smoke` (bootstrap + static embed audit, no LLM).
- R3. CI: `pnpm trask:smoke:stack-bootstrap` + `pnpm verify:trask-discord:ci`.
- R4. Docs arc #69; CONTRIBUTING, README, trask-ops, closeout.

## Verification

```bash
pnpm trask:gate
pnpm trask:smoke:stack-bootstrap
pnpm verify:trask-discord:ci
```
