---
title: "perf(trask): skip redundant check in trask:gate"
type: perf
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-089-trask-gate-single-build-smoke-plan.md
---

# Skip Redundant Check in trask:gate

## Summary

After PR #62, `trask:gate` runs one `pnpm build` then smoke and measure with `TRASK_SKIP_BUILD=1`. Full `optimize-measure` still runs `pnpm check`, duplicating `tsc -b`. Set `TRASK_OPTIMIZE_SKIP_CHECK=1` on the gate-orchestrated full measure step only; sync docs to arc **PR #33–#62**.

## Requirements

- R1. `package.json` `trask:gate` full measure step uses `TRASK_OPTIMIZE_SKIP_CHECK=1` with `TRASK_SKIP_BUILD=1`.
- R2. `scripts/trask_optimize_measure.mjs` documents gate/CI skip-check; standalone `pnpm trask:optimize-measure` unchanged.
- R3. AGENTS, closeout, module-architecture, root-script imports, validation-ladder arc **#33–#62** and gate ladder wording.
- R4. `pnpm trask:gate` exits 0 with **composite_score 165**.

## Scope Boundaries

- No Holocron live e2e in this slice.

## Verification

```bash
pnpm trask:gate
```
