---
title: "feat(verify): verify:trask-cli:ci + arc PR #33–#70 sync"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-097-trask-smoke-stack-bootstrap-ci-discord-plan.md
---

# CLI CI Import Smoke + Arc #70 Sync

## Summary

PR #70 landed stack-bootstrap and Discord CI smoke but arc docs stopped at #69. Add `verify:trask-cli:ci`, CI step, contributor checklist, and sync arc to **#33–#70**.

## Requirements

- R1. `--import-smoke` in `verify_trask_cli_qa.mjs` (golden TSLPatcher + MDLOps, RICH grade).
- R2. `verify:trask-cli:ci` + CI step after `verify:trask-discord:ci`.
- R3. Arc **#33–#70**; AGENTS bootstrap link; PR template QA scripts section.
- R4. `pnpm trask:gate`, `pnpm verify:trask-cli:ci` pass.

## Verification

```bash
pnpm trask:gate && pnpm verify:trask-cli:ci
```
