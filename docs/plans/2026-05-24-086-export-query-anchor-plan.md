---
title: "feat(trask): export query-anchor from package index"
type: feat
status: active
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md
---

# Export query-anchor From Package Index

## Summary

`query-anchor.ts` is public for display and compose but only re-exported through `grounded-evidence.ts`. Export it from `@openkotor/trask` index directly and remove the duplicate re-export block to avoid future duplicate-export errors when adding more index exports.

## Requirements

- R1. `packages/trask/src/index.ts` exports `query-anchor.js`.
- R2. Remove redundant `export { ... } from "./query-anchor.js"` from `grounded-evidence.ts` (keep imports).
- R3. Module architecture doc marks `query-anchor` as exported from index.
- R4. `pnpm trask:gate` exits 0.

## Scope Boundaries

- `citation-markers.ts` stays internal.

## Verification

```bash
pnpm trask:gate
node -e "import { BRIEF_DISCORD_MIN_CITATIONS } from '@openkotor/trask'; console.log(BRIEF_DISCORD_MIN_CITATIONS)"
```
