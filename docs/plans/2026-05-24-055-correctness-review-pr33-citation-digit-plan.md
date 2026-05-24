---
title: "review: correctness pass on PR #33 citation digit policy"
type: review
status: completed
merged: 99455eb
date: 2026-05-24
origin: docs/plans/2026-05-24-054-optimize-trask-citation-digit-policy-plan.md
pr: 33
---

# Correctness Review — PR #33 Citation Digit Policy

## Summary

PR [#33](https://github.com/OpenKotOR/community-bots/pull/33) aligns Discord citation regex to `\d{1,3}` and adds `[10]` stress tests. Before merge, run **ce-correctness-reviewer** on the branch diff to catch logic errors, edge cases, and intent mismatches; fix any actionable findings and re-verify `pnpm trask:optimize-measure`.

## Requirements

- R1. Review `packages/trask/src/discord-reply-format.ts` and tests for citation index handling (`[1]`–`[999]`, normalization, embed, filter, clamp paths).
- R2. Confirm no remaining `\d{1,2}` citation paths in Discord format pipeline that would diverge from `grounded-evidence.ts`.
- R3. Fix correctness issues found by review (not style-only).
- R4. Gates: `pnpm trask:optimize-measure` composite_score **135**, faithfulness 5/5, all unit suites green.
- R5. Update plan `status: completed` and ship PR #33 (merge or squash per repo norm).

## Scope Boundaries

- Holocron browser e2e, live Discord verify, indexer changes.
- Shared citation module extraction (unless review blocks merge without it).

## Implementation Units

### U1. Correctness review (ce-correctness-reviewer)

**Requirements:** R1, R2

**Files:** PR diff on `feat/optimize-trask-citation-digit-policy`

**Test scenarios for reviewer:**

- Body with `[10]` and Sources line `10. …` maps to correct URL in `formatDiscordAskDisplay`.
- `normalizeBodyCitationIndices` preserves distinctness when indices are two-digit.
- No false match on non-citation brackets (e.g. markdown links already embedded).
- `filterDiscordLinesForQuery` / `clampDiscordBodyLines` still enforce `BRIEF_DISCORD_MIN_CITATIONS` with `[10]` in pool.

### U2. Apply fixes

**Requirements:** R3, R4

**Verification:** `pnpm build && pnpm trask:optimize-measure`

### U3. Ship PR #33

**Requirements:** R5

**Verification:** PR merged; optional `chore(ship)` plan on `main`.

## Sources

- `docs/plans/2026-05-24-054-optimize-trask-citation-digit-policy-plan.md`
- Branch: `feat/optimize-trask-citation-digit-policy`
