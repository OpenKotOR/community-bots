---
status: completed
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-06-04-010-feat-trask-e2e-ladder-closeout-plan.md
date: 2026-06-05
---

# Plan: Holocron Docker CI — trask github-citation-url subpath

## Problem

Docker Builds CI failed: Vite cannot resolve `@openkotor/trask/github-citation-url` in `answer-presentation.ts` because `@openkotor/trask` was a devDependency (skipped under `NODE_ENV=production`) and Docker did not build `@openkotor/trask` before Holocron.

## Fix

| ID | Change |
|----|--------|
| R1 | Move `@openkotor/trask` to `dependencies` in `apps/holocron-web/package.json` |
| R2 | `apps/holocron-web/Dockerfile`: `pnpm --filter @openkotor/trask build` before holocron-web |
| R3 | `infra/trask-http-public/Dockerfile`: explicit trask build before holocron-web |

## Verification

- Local `pnpm --filter @openkotor/holocron-web build`
- PR #98 `docker-builds` + full `CI` jobs green after push
