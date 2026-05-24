---
title: "refactor: finish root Trask script package imports"
type: refactor
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-084-root-scripts-openkotor-config-import-plan.md
---

# Finish Root Trask Script Package Imports

## Summary

PRs #54–#57 migrated faithfulness, verify, and config loaders to `@openkotor/trask`, `@openkotor/trask-config`, and `@openkotor/config`. Two Trask scripts still deep-import `@openkotor/retrieval` via `packages/retrieval/dist`. Finish the migration and document the root devDependency pattern.

## Requirements

- R1. Root `package.json` devDependency `@openkotor/retrieval`: `workspace:*`.
- R2. `check_trask_config_drift.mjs` and `export_trask_allowlist_catalog.mjs` import from `@openkotor/retrieval`.
- R3. New `docs/solutions/tooling-decisions/trask-root-script-package-imports-2026-05-24.md` documents PR #54–#57 + this slice.
- R4. `CONTRIBUTING.md` notes root workspace devDependencies used by verification scripts.
- R5. Closeout title/arc through PR **#57** (this PR **#58**).
- R6. `pnpm trask:gate` and `pnpm trask:config-drift` exit 0.

## Scope Boundaries

- `trask_optimize_measure.mjs` keeps explicit `packages/trask/dist/*.test.js` paths (test runner by file path).

## Verification

```bash
pnpm install
pnpm trask:gate
pnpm trask:config-drift
node scripts/export_trask_allowlist_catalog.mjs
```
