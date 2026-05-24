---
title: "feat: add pnpm trask:optimize-measure:ci script"
type: feat
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-069-ci-trask-optimize-composite-floor-plan.md
---

# Add trask:optimize-measure:ci Script

## Summary

Expose CI-equivalent citation gate as `pnpm trask:optimize-measure:ci` so agents and operators can reproduce GitHub Actions behavior without memorizing env vars.

## Requirements

- R1. `package.json` script `trask:optimize-measure:ci` sets `TRASK_OPTIMIZE_CI_MODE=1` and `TRASK_SKIP_BUILD=1`.
- R2. Document in `docs/trask-ops.md`, `trask-citation-module-architecture` solutions doc, and README Trask section.
- R3. `pnpm trask:optimize-measure` and `pnpm trask:optimize-measure:ci` both pass with composite_score **165**.

## Scope Boundaries

- Changing optimize measure logic.
- Holocron e2e.

## Verification

`pnpm build && pnpm trask:optimize-measure && pnpm trask:optimize-measure:ci`
