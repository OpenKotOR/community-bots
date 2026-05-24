---
title: "perf: CI skip redundant Trask builds and duplicate tests"
type: perf
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-050-maintainability-optimize-ladder-plan.md
---

# CI Trask Skip-Build Performance

## Summary

performance-optimizer follow-up: CI runs workspace `tsc -b` up to four times per job. Introduce `TRASK_SKIP_BUILD`, `TRASK_OPTIMIZE_SKIP_UNIT_TESTS`, and `TRASK_OPTIMIZE_SKIP_CHECK` so config-drift, optimize-measure, and holocron e2e reuse the authoritative `pnpm build` without weakening gates.

---

## Requirements

- R1. `scripts/lib/trask_skip_build.mjs` — `ensureWorkspaceBuilt()` honors `TRASK_SKIP_BUILD=1` with dist marker checks.
- R2. `trask_optimize_measure.mjs`, `holocron-e2e-live-build.mjs`, `check_trask_config_drift.mjs` use `ensureWorkspaceBuilt`.
- R3. `trask:config-drift` script drops embedded `pnpm build`.
- R4. CI sets skip envs after first `pnpm build`; removes standalone `pnpm check` step.
- R5. Local runs without skip envs behave as today.
- R6. `pnpm trask:optimize-measure` passes locally (full) and with CI skip envs after build.

---

## Scope Boundaries

- Holocron Playwright full run in this session.
- Skipping Vite holocron build.

---

## Implementation Units

- U1. `trask_skip_build.mjs` + script wiring.
- U2. CI workflow + docs.
- U3. PR + ship record.

---

## Authority path

`docs/plans/2026-05-24-050-maintainability-optimize-ladder-plan.md`
