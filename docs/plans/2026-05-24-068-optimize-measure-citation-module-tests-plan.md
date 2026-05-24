---
title: "feat: wire citation module tests into optimize-measure"
type: feat
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-067-extract-query-anchor-plan.md
---

# Wire Citation Module Tests into optimize-measure

## Summary

Add `query-anchor.test.ts` and extend `scripts/trask_optimize_measure.mjs` to run `research-answer-split`, `query-anchor`, and `citation-markers` unit suites alongside existing discord/grounded/compose tests. Keep **composite_score** formula unchanged (discord stress count × 10 + faithfulness + check).

## Requirements

- R1. New `packages/trask/src/query-anchor.test.ts` covering `BRIEF_DISCORD_MIN_CITATIONS`, `distinctiveAnchorTokens`, `claimMatchesQueryAnchor`, `passageMatchesQueryAnchor`.
- R2. `trask_optimize_measure.mjs` runs split, anchor, and markers test files when unit tests enabled.
- R3. JSON payload adds `split_test_pass`, `anchor_test_pass`, `markers_test_pass`; `trask_unit_pass_rate` includes all six trask unit suites.
- R4. Docs: KB citation contract + solutions doc note auxiliary suites in gate 1.
- R5. `pnpm trask:optimize-measure` → composite_score **165** unchanged.

## Scope Boundaries

- Changing composite_score weighting formula.
- Live Discord/Holocron gates.

## Verification

`pnpm build && pnpm trask:optimize-measure`
