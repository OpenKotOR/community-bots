---
title: "refactor: root verify scripts import @openkotor/config"
type: refactor
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-083-root-scripts-trask-config-import-plan.md
---

# Root Verify Scripts Import @openkotor/config

## Summary

PR #56 moved trask-config imports to the package entry. Live verify scripts still deep-import `packages/config/dist/index.js` for wizard/AI runtime config. Finish the root script package-entry migration and fix `holocron_browser_verify.sh` trask-config paths.

## Requirements

- R1. Root `package.json` devDependency `@openkotor/config`: `workspace:*`.
- R2. `verify_trask_cli_qa.mjs`, `verify_trask_discord_live.mjs`, `discord_ask_display_proof.mjs` import `loadResearchWizardRuntimeConfig` and `loadSharedAiConfig` from `@openkotor/config`.
- R3. `holocron_browser_verify.sh` uses `@openkotor/trask-config` in inline `node -e` blocks.
- R4. Closeout doc title → PR **#33–#56**.
- R5. `pnpm trask:gate` and `pnpm trask:config-drift` exit 0.

## Scope Boundaries

- No new package exports from `@openkotor/trask`.

## Verification

```bash
pnpm install
pnpm trask:gate
pnpm trask:config-drift
```
