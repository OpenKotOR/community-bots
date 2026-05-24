---
title: "feat(holocron): e2e imports @openkotor/trask-config"
type: feat
status: completed
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-root-script-package-imports-2026-05-24.md
---

# Holocron E2E trask-config Package Import

## Summary

`apps/holocron-web/e2e/holocron-research.spec.ts` is the last Holocron/CI path that deep-imports `packages/trask-config/dist/*`. Add `@openkotor/trask-config` as a holocron-web devDependency and import policy/verification queries from the package entry so CI Playwright matches the root-script package contract.

## Requirements

- R1. `apps/holocron-web/package.json` lists `@openkotor/trask-config` as `workspace:*` devDependency.
- R2. `holocron-research.spec.ts` imports `loadTraskPolicy` and `verificationQueriesForSurface` from `@openkotor/trask-config`.
- R3. `trask-root-script-package-imports-2026-05-24.md` notes Holocron e2e uses the package entry (PR #61 arc).
- R4. `pnpm install` + `pnpm build` succeed; `pnpm trask:gate` exits 0.

## Scope Boundaries

- No Holocron live browser run in this slice (CI already runs e2e on merge).
- No smoke script extension in this slice.

## Verification

```bash
pnpm install
pnpm build
pnpm trask:gate
rg 'packages/trask-config/dist' apps/holocron-web -n || true
```
