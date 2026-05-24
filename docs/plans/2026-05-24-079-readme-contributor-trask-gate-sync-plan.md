---
title: "docs: README and contributor trask:gate ladder sync"
type: docs
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-078-agents-trask-gate-docs-sync-plan.md
---

# README and Contributor trask:gate Ladder Sync

## Summary

PRs #49–#51 introduced `pnpm trask:gate` and wired live verify scripts to use it. `README.md`, `CONTRIBUTING.md`, module-architecture gate table, closeout doc, and PR template still describe `optimize-measure` alone for live paths.

## Requirements

- R1. `README.md` Verify section recommends `pnpm trask:gate` and notes live scripts preflight with it.
- R2. `CONTRIBUTING.md` states `verify:trask-*` and `holocron:e2e` run `trask:gate` before live steps.
- R3. `trask-citation-module-architecture-2026-05-24.md` gate table adds `trask:gate` row; live rows say `trask:gate` preflight.
- R4. `trask-citation-stack-closeout-2026-05-24.md` arc table includes PRs #49–#51.
- R5. PR template drops redundant optional `:ci` checkbox when `trask:gate` is checked.
- R6. `pnpm trask:gate` exits 0.

## Scope Boundaries

- No code or CI workflow changes.

## Verification

```bash
pnpm trask:gate
```
