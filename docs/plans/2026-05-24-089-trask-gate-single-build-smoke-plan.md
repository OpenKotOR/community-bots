---
title: "perf(trask): single-build gate and extended import smoke"
type: feat
status: completed
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-root-script-package-imports-2026-05-24.md
---

# Single-Build trask:gate and Extended Import Smoke

## Summary

Local `pnpm trask:gate` currently runs `pnpm build` twice (smoke-imports + optimize-measure). Orchestrate one build, then smoke + measure with `TRASK_SKIP_BUILD=1`. Add `trask:smoke-imports:ci`, extend smoke assertions for holocron/faithfulness/drift symbols, sync docs to PR **#33–#61**, and mark plan **087** completed.

## Requirements

- R1. `trask:smoke-imports:ci` runs smoke only with `TRASK_SKIP_BUILD=1`; `trask:gate` runs one `pnpm build` then smoke + full + `:ci` with skip-build on subsequent steps.
- R2. `scripts/trask_smoke_package_imports.mjs` asserts `loadTraskPolicy`, `verificationQueriesForSurface('holocron')`, `loadGoldenQueries`, `citationIndicesInText`, `defaultSourceCatalog`.
- R3. CI uses `pnpm trask:smoke-imports:ci` after build (not raw node path).
- R4. AGENTS, closeout, module-architecture arc **#33–#61**; plan **087** status **completed**.
- R5. `pnpm trask:gate` exits 0 (composite_score **165**).

## Scope Boundaries

- Do not remove `pnpm check` from full optimize-measure in this slice.

## Verification

```bash
pnpm trask:gate
```
