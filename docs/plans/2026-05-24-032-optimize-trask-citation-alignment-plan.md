---
title: "optimize: Trask Discord citation alignment loop"
type: optimize
status: completed
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md
---

# Optimize Trask Discord Citation Alignment

## Summary

Bootstrap `ce-optimize` measurement scaffolding for Trask citation/compose paths, then run a bounded serial optimization loop (≤4 iterations) on `discord-reply-format.ts` and `grounded-evidence.ts` to improve offline citation stress coverage while preserving faithfulness and unit-test gates.

---

## Requirements

- R1. `scripts/trask_optimize_measure.mjs` emits JSON with pass counts for faithfulness + Trask unit suites.
- R2. Degenerate gates: faithfulness 5/5, all scoped Trask tests pass, `pnpm check` pass.
- R3. Primary metric: `citation_stress_pass_count` (maximize) from discord-reply-format stress tests.
- R4. Scope immutable: measurement scripts, existing golden fixtures, eval harness.
- R5. Serial loop (`max_iterations: 4`, `max_hours: 1`); optimization branch `optimize/trask-citation-alignment`.
- R6. Ship via PR when loop completes with improved or equal score and no gate regressions.

---

## Scope Boundaries

- Live Holocron e2e or Discord bot posting.
- Retrieval/indexer rerank changes.
- Full wizard/web-research compose unification.

---

## Implementation Units

- U1. **Bootstrap ce-optimize harness**

**Requirements:** R1, R4

**Files:**
- Create: `scripts/trask_optimize_measure.mjs`
- Create: `scripts/measure.sh`
- Create: `scripts/experiment-worktree.sh`
- Create: `.context/compound-engineering/ce-optimize/trask-citation-alignment/spec.yaml`

**Verification:** JSON baseline recorded in experiment log.

---

- U2. **Add citation stress tests**

**Requirements:** R3

**Files:**
- Modify: `packages/trask/src/discord-reply-format.test.ts`

**Approach:** Expert-phrasing edge cases (low-score second citation, clamp after filter, reordered indices).

**Verification:** Measure script reports stress pass count.

---

- U3. **Run optimization loop**

**Requirements:** R2, R3, R5

**Files:**
- Modify: `packages/trask/src/discord-reply-format.ts`
- Modify: `packages/trask/src/grounded-evidence.ts` (only if stress tests require)

**Approach:** Serial experiments on citation preservation / simplification hypotheses.

**Verification:** Experiment log shows kept experiments; gates hold.

---

- U4. **Ship optimization branch**

**Requirements:** R6

**Approach:** PR from `optimize/trask-citation-alignment` → `main`.

---

## Sources & References

- `docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md`
- `pnpm trask:faithfulness-eval`
- ce-optimize skill
