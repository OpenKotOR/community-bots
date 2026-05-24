---
title: "docs: sync Discord citation compound docs after PR #24–#26"
type: docs
status: completed
date: 2026-05-24
merged: 4a67c6a
pr: https://github.com/OpenKotOR/community-bots/pull/27
origin: docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md
---

# Compound Discord Citation Docs Sync

## Summary

After PRs #24–#26, operator docs and the slash contract still reference only PR #15. Refresh solution doc history, KB contract links, and add a `pnpm trask:optimize-measure` script alias for the ce-optimize harness.

---

## Requirements

- R1. `trask-discord-dual-citation-line-filter-2026-05-24.md` History covers PR #24 (`85a66fd`), #25 (`5455582`), #26 (`4935482`) and exported `citationIndicesInLines` / `citationIndicesInText`.
- R2. `trask-discord-slash-contract.md` `lastUpdated` 2026-05-24; Related links mention optimize harness + exported helpers.
- R3. `package.json` adds `"trask:optimize-measure": "node scripts/trask_optimize_measure.mjs"`.
- R4. `node scripts/trask_optimize_measure.mjs` passes (composite_score ≥ 115).
- R5. ce-code-review: `Residual actionable work: none.`

---

## Scope Boundaries

- Runtime citation behavior changes.
- Holocron e2e / Discord live verify.

---

## Implementation Units

- U1. Solution doc History + Verification.
- U2. KB slash contract refresh.
- U3. package.json script alias.
- U4. PR + ship record on merge.

---

## Authority path

`docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md`
