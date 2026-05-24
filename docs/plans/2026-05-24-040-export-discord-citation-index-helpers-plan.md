---
title: "refactor: export Discord citation index helpers for tests"
type: refactor
status: completed
date: 2026-05-24
merged: 4935482
pr: https://github.com/OpenKotOR/community-bots/pull/26
origin: docs/plans/2026-05-24-034-maintainability-closeout-pr24-plan.md
---

# Export Discord Citation Index Helpers

## Summary

Tests in `discord-reply-format.test.ts` duplicate citation-index extraction regex logic already implemented in `discord-reply-format.ts`. Export `citationIndicesInLines` and `citationIndicesInText` so tests assert against the same implementation as production (RegExp split from PR #25).

---

## Requirements

- R1. Export `citationIndicesInLines` and `citationIndicesInText` from `packages/trask/src/discord-reply-format.ts` using existing `CITATION_INDEX_CAPTURE_RE`.
- R2. Remove duplicate `distinctCitationIndices*` helpers from `discord-reply-format.test.ts`; import exports instead.
- R3. `pnpm build`, `node scripts/trask_optimize_measure.mjs` — composite_score ≥ 115.
- R4. ce-code-review autofix: `Residual actionable work: none.`

---

## Scope Boundaries

- Behavior change to citation filtering or clamp logic.
- Holocron e2e / Discord live verify.

---

## Implementation Units

- U1. Export helpers from `discord-reply-format.ts`.
- U2. Update `discord-reply-format.test.ts` imports and assertions.
- U3. Ship via PR + `chore(ship)` on merge.

---

## Authority path

`docs/plans/2026-05-24-034-maintainability-closeout-pr24-plan.md`
