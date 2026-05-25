---
title: "feat(verify): auto-bootstrap stack for verify:trask-cli"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-093-holocron-e2e-stack-bootstrap-plan.md
---

# verify:trask-cli Indexed Stack Bootstrap

## Summary

Holocron e2e (#66) auto-starts indexer+Worker via `ensure_trask_indexed_stack_for_e2e.sh`. `verify:trask-cli` still expects a manual stack. Add shared `trask_qa_stack_bootstrap.mjs` and call it from CLI verify before golden queries. Sync arc docs to **PR #33–#66**.

## Requirements

- R1. `scripts/lib/trask_qa_stack_bootstrap.mjs` sets CI-parity env and runs `ensure_trask_indexed_stack_for_e2e.sh`.
- R2. `scripts/verify_trask_cli_qa.mjs` calls bootstrap after `loadEnvFiles`.
- R3. `AGENTS.md`, `docs/trask.md`, `trask-indexed-stack-runbook.md`, closeout arc **#33–#66**.
- R4. `pnpm trask:gate` and `pnpm verify:trask-cli` exit 0.

## Scope Boundaries

- No Discord verify changes.

## Verification

```bash
pnpm trask:gate && pnpm verify:trask-cli
```
