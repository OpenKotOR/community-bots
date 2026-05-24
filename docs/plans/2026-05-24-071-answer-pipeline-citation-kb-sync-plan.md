---
title: "docs: sync answer-pipeline and runtime-map for citation modules"
type: docs
status: active
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md
---

# Answer Pipeline and Runtime Map Citation Sync

## Summary

Close KB drift after PR #43: `answer-pipeline.md` and `trask-runtime-map.md` still describe citations only via `citation-markers` / `formatDiscordAskDisplay` without `research-answer-split`, `query-anchor`, or CI optimize mode.

## Requirements

- R1. Update `answer-pipeline.md` step 8 and related docs for module stack + local vs CI gates.
- R2. Update `trask-runtime-map.md` citation bullet with full module list and link to compound solutions doc.
- R3. Add cross-link from `trask-discord-dual-citation-line-filter` solutions doc to module architecture doc.
- R4. `pnpm trask:optimize-measure` → composite_score **165** (docs only).

## Scope Boundaries

- Code changes in `packages/trask`.
- Live verification runs.

## Verification

`pnpm trask:optimize-measure`
