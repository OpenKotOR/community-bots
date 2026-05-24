---
title: "docs: sync AGENTS and trask.md with trask:gate ladder"
type: docs
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-077-wire-trask-gate-live-verify-plan.md
---

# Sync AGENTS and trask.md With trask:gate Ladder

## Summary

PR #50 wired `verify:trask-*` and `holocron:e2e` to preflight with `pnpm trask:gate`. `AGENTS.md` and `docs/trask.md` still describe `trask:optimize-measure` only for those paths, which misleads agents running Holocron/Discord verification.

## Requirements

- R1. `AGENTS.md` Holocron offline-gate section recommends `pnpm trask:gate` first; prose states `holocron:e2e` and `verify:trask-*` preflight with `trask:gate`.
- R2. `AGENTS.md` learned facts cite PR #49–#50 for gate script and live-verify preflight.
- R3. `docs/trask.md` Holocron e2e / CLI verify sections note `trask:gate` offline preflight before live steps.
- R4. `pnpm trask:gate` exits 0 (composite_score **165**).

## Scope Boundaries

- No `package.json` or CI workflow changes.
- No live Holocron or Discord runs.

## Verification

```bash
pnpm trask:gate
```
