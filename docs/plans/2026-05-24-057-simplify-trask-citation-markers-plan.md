---
title: "refactor: shared Trask citation marker module"
type: refactor
status: completed
merged: 2ca7ece
date: 2026-05-24
origin: docs/plans/2026-05-24-056-ship-pr33-citation-digit-policy-plan.md
---

# Simplify Trask Citation Markers (Post–PR #33)

## Summary

PR #33 aligned Discord citation regex to `\d{1,3}` but duplicated patterns and index-parsing logic across `discord-reply-format.ts` and `grounded-evidence.ts`. Extract a small `citation-markers.ts` module so one definition drives marker detection, capture, replace, and `index > 0` parsing. Preserve behavior; `pnpm trask:optimize-measure` must stay at composite_score **155**.

## Requirements

- R1. Create `packages/trask/src/citation-markers.ts` with non-global marker regex, global capture regex, and `parseCitationIndex(raw)` (`> 0` guard).
- R2. `discord-reply-format.ts` imports shared markers; remove inline `\d{1,3}` literals and duplicate index parsing in `citationIndicesInLines`.
- R3. `grounded-evidence.ts` uses shared capture regex / parser in `collectCitationIndicesFromAnswer` (and body presence check if trivial).
- R4. No behavior change: `pnpm trask:optimize-measure` composite_score **155**, faithfulness 5/5.
- R5. Ship via PR from `feat/simplify-trask-citation-markers`.

## Scope Boundaries

- `embedInlineCitationLinks` double-wrap guard (deferred).
- Holocron e2e / live Discord verify.

## Implementation Units

### U1. Shared module

**Files:** `packages/trask/src/citation-markers.ts`

**Test scenarios:** `parseCitationIndex` rejects `0`, accepts `1` and `10`.

### U2. Wire consumers

**Files:** `discord-reply-format.ts`, `grounded-evidence.ts`

**Verification:** `node --test` on trask discord + grounded tests; `pnpm trask:optimize-measure`.

### U3. ce-simplify / simplicity review

**Verification:** No redundant regex literals remain in consumers.

## Sources

- Deferred from PR #33 review: shared citation regex module
- `ce-simplify-code` / `ce-code-simplicity-reviewer`
