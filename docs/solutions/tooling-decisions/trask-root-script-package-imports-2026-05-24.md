---
title: "Trask root script package imports (PR #54–#58)"
date: 2026-05-24
category: tooling-decisions
problem_type: tooling
component: trask
module: trask
tags:
  - trask
  - scripts
  - package-imports
applies_when: "Adding or changing repo-root verification scripts that import workspace packages"
last_gate: "pnpm trask:gate"
---

## Problem

Root scripts under `scripts/` historically deep-imported `packages/*/dist/*.js`, which breaks when package layout changes and hides the intended public API surface.

## Solution

Root `package.json` lists workspace packages as **devDependencies** so Node resolves them like any other dependency:

| Package | Used by |
|---------|---------|
| `@openkotor/trask` | Faithfulness eval, verify CLI/Discord, display proof |
| `@openkotor/trask-config` | Golden/verification queries, policy, `trask-env` repo root |
| `@openkotor/config` | Wizard + shared AI runtime config in live verify scripts |
| `@openkotor/retrieval` | Config drift catalog check, allowlist export for indexer |

## Shipped PRs

| PR | Change |
|----|--------|
| #54 | Export `research-answer-split` from `@openkotor/trask` index |
| #55 | Verify scripts import `@openkotor/trask` |
| #56 | Scripts import `@openkotor/trask-config` |
| #57 | Verify scripts import `@openkotor/config`; holocron browser verify uses package entries |
| #59 | Export `query-anchor` from `@openkotor/trask` index |
| #58 | Config drift + allowlist export import `@openkotor/retrieval` |

## Exceptions

- `scripts/trask_optimize_measure.mjs` runs unit tests by **file path** (`packages/trask/dist/*.test.js`) — intentional for the Node test runner harness.
- `citation-markers.ts` remains **internal** (not exported from `@openkotor/trask` index).

## Verification

```bash
pnpm trask:gate
pnpm trask:config-drift
```

See also [trask-citation-stack-closeout-2026-05-24.md](trask-citation-stack-closeout-2026-05-24.md).
