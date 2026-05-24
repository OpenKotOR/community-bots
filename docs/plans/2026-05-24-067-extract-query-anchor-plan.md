---
title: "refactor: extract query-anchor module"
type: refactor
status: active
date: 2026-05-24
origin: docs/knowledgebase/10-architecture-runtime/trask-citation-display-contract.md
---

# Extract query-anchor Module

## Summary

Move `BRIEF_DISCORD_MIN_CITATIONS`, `distinctiveAnchorTokens`, `claimMatchesQueryAnchor`, and `passageMatchesQueryAnchor` into `packages/trask/src/query-anchor.ts` so `discord-reply-format.ts` no longer imports `grounded-evidence.ts` (display layer decoupled from compose).

## Requirements

- R1. New `query-anchor.ts` with anchor token helpers and `BRIEF_DISCORD_MIN_CITATIONS`; no imports from `grounded-evidence` or `discord-reply-format`.
- R2. `grounded-evidence.ts` imports anchor APIs from `query-anchor.ts` and re-exports for existing callers (`research-wizard.ts`).
- R3. `discord-reply-format.ts` and `discord-reply-format.test.ts` import from `query-anchor.ts` only.
- R4. KB citation contract notes display→compose dependency direction.
- R5. `pnpm trask:optimize-measure` → composite_score **165**.

## Scope Boundaries

- Moving compose/ranking logic beyond anchor helpers.
- Package public index exports.

## Verification

`pnpm build && pnpm trask:optimize-measure`
