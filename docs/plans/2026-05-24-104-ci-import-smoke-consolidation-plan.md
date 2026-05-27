---
title: "feat(ci): consolidate Trask import-smoke CI + ladder sync"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-103-trask-gate-ci-arc-75-closeout-plan.md
---

# CI import-smoke consolidation

## Requirements

- R1. `.github/workflows/ci.yml` uses `pnpm trask:verify-import-smoke:ci`
- R2. AGENTS, validation-ladder, CONTRIBUTING, answer-pipeline, trask-research-backends aligned
- R3. `trask-root-script-package-imports` arc through #76

## Verification

```bash
pnpm build && pnpm trask:gate:ci
TRASK_SKIP_BUILD=1 pnpm trask:verify-import-smoke:ci  # with stack up
```
