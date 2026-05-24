---
title: "refactor: root scripts import @openkotor/trask-config"
type: refactor
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-082-verify-scripts-openkotor-trask-import-plan.md
---

# Root Scripts Import @openkotor/trask-config

## Summary

PR #55 moved live verify scripts to `@openkotor/trask`. Several root scripts still deep-import `packages/trask-config/dist/*`. Add root devDependency and use the package entry for golden/verification queries and policy helpers.

## Requirements

- R1. Root `package.json` devDependency `@openkotor/trask-config`: `workspace:*`.
- R2. Update imports in `trask_faithfulness_eval.mjs`, `verify_trask_cli_qa.mjs`, `verify_trask_discord_live.mjs`, `discord_ask_display_proof.mjs`, `verify_trask_webui_browser.mjs`, `lib/trask-env.mjs`, `check_trask_config_drift.mjs`.
- R3. Closeout arc notes PR **#55** verify-script package imports.
- R4. `pnpm trask:gate` exits 0.

## Scope Boundaries

- No `@openkotor/config` migration.
- `trask_optimize_measure.mjs` test file paths stay as `packages/trask/dist/*.test.js`.

## Verification

```bash
pnpm install
pnpm trask:gate
pnpm trask:config-drift
```
