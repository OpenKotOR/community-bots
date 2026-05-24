---
title: "maintainability: close out PR #24 citation alignment"
type: refactor
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-033-ship-pr24-citation-alignment-plan.md
pr: https://github.com/OpenKotOR/community-bots/pull/24
merged: 85a66fd
---

# Maintainability Closeout — PR #24 Citation Alignment

## Summary

Post-merge maintainability pass on PR #24: dedupe citation-marker checks, simplify index tracking in `sliceLinesPreservingDistinctCitations`, record ship authority, and extend the dual-citation solution doc.

---

## Requirements

- R1. ce-maintainability-reviewer APPROVE or fixes applied (no behavior change).
- R2. `node scripts/trask_optimize_measure.mjs` composite_score ≥ 115; faithfulness 5/5.
- R3. ce-code-review autofix: `Residual actionable work: none.`
- R4. `chore(ship)` on `main` records merge SHA `85a66fd`.

---

## Scope Boundaries

- New ce-optimize iterations.
- Extracting a separate citation module (deferred unless file grows again).

---

## Implementation Units

- U1. **Maintainability dedupe in discord-reply-format.ts** — shared citation marker regex; reuse `citationIndicesInLines` in slice helper.
- U2. **Docs** — solution doc note + ship record plan update.
- U3. **PR to main** — small follow-up after PR #24 merge.

---

## Authority path

`docs/plans/2026-05-24-032-optimize-trask-citation-alignment-plan.md`
