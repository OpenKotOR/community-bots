---
title: "feat(trask): wire config-drift into trask:gate"
type: feat
status: completed
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-citation-stack-closeout-2026-05-24.md
---

# Wire config-drift Into trask:gate

## Summary

CI runs `pnpm trask:config-drift` after build and smoke; local `pnpm trask:gate` does not. Add drift check to gate (with `TRASK_SKIP_BUILD=1`) so offline preflight matches CI and contributors cannot skip golden/catalog policy gates.

## Requirements

- R1. `package.json` `trask:gate` runs `TRASK_SKIP_BUILD=1 pnpm trask:config-drift` after smoke, before optimize-measure.
- R2. `AGENTS.md`, `CONTRIBUTING.md`, `validation-ladder.md` document config drift inside `trask:gate`.
- R3. Closeout + module-architecture arc note for gate includes config drift.
- R4. `pnpm trask:gate` and `pnpm trask:config-drift` exit 0.

## Scope Boundaries

- No Holocron live e2e.

## Verification

```bash
pnpm trask:gate
```
