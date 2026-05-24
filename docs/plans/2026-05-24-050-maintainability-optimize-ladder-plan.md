---
title: "maintainability: review optimize-measure verification ladder"
type: refactor
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-048-optimize-measure-ci-holocron-plan.md
---

# Maintainability Review — Optimize Measure Ladder (PR #28–#30)

## Summary

Run **ce-maintainability-reviewer** on the PR #28–#30 verification ladder (`trask:optimize-measure`, CI, `holocron:e2e`, `verify:trask-*` preflights) and `packages/trask/src/discord-reply-format.ts` exports. Apply behavior-preserving fixes only; no new citation features.

---

## Requirements

- R1. ce-maintainability-reviewer findings: APPROVE or safe fixes applied (no behavior change).
- R2. Address CI double-run of `trask:optimize-measure` if reviewer flags it (CI step vs `holocron:e2e` script) without weakening gates.
- R3. Deduplicate citation-index collection in `scripts/trask_faithfulness_eval.mjs` via exported `citationIndicesInText` where digit policy matches.
- R4. `pnpm trask:optimize-measure` composite_score ≥ 115 after changes.
- R5. ce-code-review autofix: `Residual actionable work: none.`

---

## Scope Boundaries

- Holocron Playwright full e2e run (unless stack already up).
- Live Discord verify.
- FileChunkStore merge epic.

---

## Review targets

- `package.json` scripts (`holocron:e2e`, `verify:trask-*`, `trask:optimize-measure`)
- `.github/workflows/ci.yml` optimize-measure step
- `scripts/trask_optimize_measure.mjs`
- `scripts/trask_faithfulness_eval.mjs`
- `packages/trask/src/discord-reply-format.ts` (exported helpers)
- `packages/trask/src/index.ts` re-exports if any

---

## Implementation Units

- U1. ce-maintainability-reviewer pass + apply safe_auto fixes.
- U2. Verification: `pnpm trask:optimize-measure`.
- U3. PR + ship record.

---

## Authority path

`docs/plans/2026-05-24-034-maintainability-closeout-pr24-plan.md`
