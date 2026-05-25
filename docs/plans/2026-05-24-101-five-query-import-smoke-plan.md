---
title: "feat(verify): five-query golden import-smoke"
type: feat
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-100-golden-import-smoke-compose-plan.md
---

# Five-query golden import-smoke

## Summary

Expand CI import-smoke from 2/5 to all canonical golden queries. Wire expert verification queries to golden fixtures via `goldenQueryId`.

## Requirements

- R1. `goldenQueryId` on each verification query + Zod + test
- R2. Derive CLI/Discord import-smoke from `trask-config` (no hardcoded 2-item lists)
- R3. Smoke-imports asserts all five composes; drift validates links
- R4. Docs arc #74 + fix #71/#72/#73 drift in closeout tables

## Verification

```bash
pnpm trask:gate && pnpm verify:trask-cli:ci && pnpm verify:trask-discord:ci
```
