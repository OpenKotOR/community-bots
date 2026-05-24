---
title: "feat: align CI and holocron:e2e with trask:optimize-measure"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-046-wire-optimize-measure-cli-verify-plan.md
---

# Align CI and Holocron E2E With Optimize Measure

## Summary

PRs #28–#29 wired `pnpm trask:optimize-measure` before live `verify:trask-*` scripts. Extend the ladder: replace the CI faithfulness-only step with the full optimize-measure gate (faithfulness + discord stress + compose suites), and preflight `pnpm holocron:e2e` the same way for local runs.

---

## Requirements

- R1. `.github/workflows/ci.yml` runs `pnpm trask:optimize-measure` instead of `pnpm trask:faithfulness-eval` (after unit tests; still before Playwright).
- R2. `holocron:e2e` in `package.json` runs `pnpm trask:optimize-measure` before `holocron-e2e-live-build.mjs`.
- R3. `docs/trask-research-backends.md` verification ladder documents CI + holocron preflight.
- R4. `pnpm trask:optimize-measure` passes locally.
- R5. ce-code-review: `Residual actionable work: none.`

---

## Scope Boundaries

- Changing Playwright spec assertions.
- Live Discord verify (already prefetched).

---

## Implementation Units

- U1. CI workflow step rename + command.
- U2. package.json `holocron:e2e`.
- U3. Operator docs + PR ship record.

---

## Authority path

`docs/plans/2026-05-24-044-wire-optimize-measure-discord-verify-plan.md`
