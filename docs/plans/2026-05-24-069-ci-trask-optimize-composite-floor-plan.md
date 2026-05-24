---
title: "ci: enforce trask optimize composite_score floor in CI"
type: fix
status: completed
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md
---

# CI Trask Optimize Composite Floor

## Summary

CI runs `pnpm trask:optimize-measure` with `TRASK_OPTIMIZE_SKIP_UNIT_TESTS=1`, so **discord stress tests never run in CI** and `composite_score` is not validated at the documented floor **165**. Add `TRASK_OPTIMIZE_CI_MODE=1` to run faithfulness + discord stress only and fail when `composite_score < 165`.

## Requirements

- R1. `trask_optimize_measure.mjs`: when `TRASK_OPTIMIZE_CI_MODE=1`, run faithfulness + `discord-reply-format.test.js` only (no duplicate full unit sweep).
- R2. Fail exit when `composite_score < TRASK_OPTIMIZE_MIN_COMPOSITE_SCORE` (default **165** in CI mode).
- R3. `.github/workflows/ci.yml`: set `TRASK_OPTIMIZE_CI_MODE=1`, remove `TRASK_OPTIMIZE_SKIP_UNIT_TESTS` / `TRASK_OPTIMIZE_SKIP_CHECK` from optimize step.
- R4. Document CI mode in solutions doc + `AGENTS.md` one line.
- R5. Local full `pnpm trask:optimize-measure` unchanged (all suites, composite **165**).

## Scope Boundaries

- Holocron e2e or live Discord in this PR.
- Renaming `pnpm trask:optimize-measure`.

## Verification

`pnpm build && TRASK_OPTIMIZE_CI_MODE=1 TRASK_SKIP_BUILD=1 pnpm trask:optimize-measure` → composite_score **165**
