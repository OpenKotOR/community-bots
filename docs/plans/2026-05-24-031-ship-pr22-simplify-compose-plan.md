---
title: "ship: merge PR #22 compose policy simplify + simplicity review"
type: ship
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-030-simplify-compose-policy-plan.md
pr: https://github.com/OpenKotOR/community-bots/pull/22
---

# Ship PR #22 — Compose Policy Simplify + Simplicity Review

## Summary

Run ce-code-simplicity-reviewer on PR #22, apply any behavior-preserving simplifications, pass code review autofix, merge when CI green, and record ship authority.

---

## Requirements

- R1. ce-code-simplicity-reviewer finds no blocking issues OR fixes are applied and verified.
- R2. ce-code-review `mode:autofix` with plan 030 reports `Residual actionable work: none.`
- R3. `pnpm build`, `pnpm check`, config + compose tests pass.
- R4. CI (Build & Test, CodeQL, docker-builds) pass on PR #22.
- R5. `gh pr merge 22 --squash` succeeds.
- R6. `chore(ship)` on `main` records merge SHA.

---

## Scope Boundaries

- New feature work or wizard/web-research compose tree unification.
- Holocron full e2e (config-only refactor).

---

## Implementation Units

- U1. **Simplicity review gate**

**Requirements:** R1

**Files:** PR #22 diff (`packages/config`, `packages/trask/src/web-research.ts`)

**Approach:** ce-code-simplicity-reviewer on full diff; apply safe simplifications only.

**Verification:** Tests pass after any edits.

---

- U2. **Code review autofix + CI**

**Requirements:** R2, R3, R4

**Approach:** ce-code-review mode:autofix plan:030; wait for CI.

---

- U3. **Merge + ship record**

**Requirements:** R5, R6

**Approach:** Squash merge; ship commit on main.

---

## Authority path

`docs/plans/2026-05-24-030-simplify-compose-policy-plan.md`
