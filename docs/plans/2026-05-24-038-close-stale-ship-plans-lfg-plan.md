---
title: "ship: close stale PR #22 ship plan and record merge authority"
type: ship
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-031-ship-pr22-simplify-compose-plan.md
pr: https://github.com/OpenKotOR/community-bots/pull/22
---

# Close Stale Ship Plans — PR #22 Authority

## Summary

PR #22 merged to `main` as `e66d699` but plan `031` remains `status: active` with no `chore(ship)` record. Close the loop: mark plan 031 completed, add ship plan `039` with merge SHA, verify measure script still passes.

---

## Requirements

- R1. `docs/plans/2026-05-24-031-ship-pr22-simplify-compose-plan.md` → `status: completed`, `merged: e66d699`.
- R2. New ship plan documents PR #22 merge authority (pattern from `037-ship-pr25-*`).
- R3. `node scripts/trask_optimize_measure.mjs` on `main` — composite_score ≥ 115.
- R4. ce-code-review autofix against this plan: `Residual actionable work: none.`
- R5. `chore(ship)` commit on `main` if not already recorded for PR #22.

---

## Scope Boundaries

- No runtime behavior changes.
- No Holocron e2e or Discord live verify.

---

## Implementation Units

- U1. Update plan 031 frontmatter and status.
- U2. Add `039-ship-pr22-compose-simplify-merge-plan.md`.
- U3. `chore(ship)` on `main` recording `e66d699`.

---

## Authority path

`docs/plans/2026-05-24-030-simplify-compose-policy-plan.md`
