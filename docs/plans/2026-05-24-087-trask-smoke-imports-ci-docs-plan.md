---
title: "feat(trask): CI smoke-imports and gate ladder docs sync"
type: feat
status: completed
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-root-script-package-imports-2026-05-24.md
---

# CI smoke-imports and Gate Ladder Docs Sync

## Summary

PR #60 wires `pnpm trask:smoke-imports` into `pnpm trask:gate`. Close the arc by running the smoke script in CI after `pnpm build` (with `TRASK_SKIP_BUILD=1`) and syncing AGENTS, closeout, README, KB ladder, trask-research-backends, and PR template to document smoke-imports inside the gate.

## Requirements

- R1. `.github/workflows/ci.yml` runs `node scripts/trask_smoke_package_imports.mjs` after TypeScript build with `TRASK_SKIP_BUILD=1`.
- R2. `AGENTS.md` documents `trask:smoke-imports` inside `trask:gate`; arc **PR #33–#60**.
- R3. `trask-citation-stack-closeout-2026-05-24.md` arc **#33–#60**; one-command preflight lists smoke-imports.
- R4. `validation-ladder.md`, `README.md`, `docs/trask-research-backends.md`, `.github/pull_request_template.md` mention smoke-imports in gate ladder.
- R5. `trask-citation-module-architecture-2026-05-24.md` related link says **#33–#60**.
- R6. `pnpm trask:gate` exits 0 (composite_score **165**).

## Scope Boundaries

- Holocron e2e `@openkotor/trask-config` migration deferred (separate slice).
- No `trask:smoke-imports:ci` package alias in this slice.

## Verification

```bash
pnpm trask:gate
```
