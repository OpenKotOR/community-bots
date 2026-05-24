---
title: "refactor: verify scripts import @openkotor/trask"
type: refactor
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-081-export-research-answer-split-plan.md
---

# Verify Scripts Import @openkotor/trask

## Summary

PR #54 added root `devDependency` on `@openkotor/trask` for faithfulness eval. Live verify scripts still deep-import `packages/trask/dist/index.js`. Switch them to the package entry and update stale preflight comments (`optimize-measure` → `trask:gate`).

## Requirements

- R1. `verify_trask_cli_qa.mjs`, `verify_trask_discord_live.mjs`, `discord_ask_display_proof.mjs` import Trask APIs from `@openkotor/trask`.
- R2. File header comments document `trask:gate` preflight (via parent `pnpm verify:*` scripts).
- R3. Closeout + module architecture titles/arc note PR **#54** export.
- R4. `pnpm trask:gate` exits 0.

## Scope Boundaries

- No changes to `trask-config` import paths in this PR.
- No live Discord/Holocron runs.

## Verification

```bash
pnpm trask:gate
```
