---
title: "ship: merge PR #25 + doc review closeout"
type: ship
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-034-maintainability-closeout-pr24-plan.md
pr: https://github.com/OpenKotOR/community-bots/pull/25
---

# Ship PR #25 — Doc Review + Maintainability Closeout

## Summary

Run ce-doc-review (coherence, feasibility, adversarial, framework-docs) on the PR #25 maintainability plan, apply safe_auto doc fixes, pass code review autofix, merge when CI green, and record ship authority.

---

## Requirements

- R1. ce-doc-review on `docs/plans/2026-05-24-034-maintainability-closeout-pr24-plan.md` with adversarial + framework-docs personas; safe_auto applied (R4/R5 clarity, U1 RegExp split documented, verification commands).
- R2. ce-code-review `mode:autofix` plan 034 reports `Residual actionable work: none.`
- R3. `node scripts/trask_optimize_measure.mjs` composite_score ≥ 115; faithfulness 5/5.
- R4. CI pass on PR #25.
- R5. `gh pr merge 25 --squash` succeeds.
- R6. `chore(ship)` on `main` records merge SHA.

---

## Scope Boundaries

- New citation features beyond PR #24 behavior.
- Live Discord verify gate.

---

## Implementation Units

- U1. **Document review gate** — plan 034 + framework alignment for RegExp/citation patterns.
- U2. **Code review + CI** — PR #25 diff.
- U3. **Merge + ship record** — squash merge.

---

## Authority path

`docs/plans/2026-05-24-034-maintainability-closeout-pr24-plan.md`
