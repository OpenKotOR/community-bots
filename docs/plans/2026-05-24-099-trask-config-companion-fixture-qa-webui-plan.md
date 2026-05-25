---
title: "feat(trask-config): companionFixture schema + public qa-webui KB"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-098-verify-trask-cli-ci-arc-70-sync-plan.md
---

# companionFixture Schema + Public qa-webui KB

## Summary

`golden-queries.json` defines `companionFixture` but Zod strips it. Add schema field, extend `goldenFixtures()`, smoke asserts, and document public Holocron Pages qa-webui.

## Requirements

- R1. `companionFixture` in `GoldenQuerySchema`; `goldenFixtures()` returns primary + companion (10).
- R2. Unit tests + `trask_smoke_package_imports` asserts.
- R3. KB `holocron-web-trask-client.md` public qa-webui section.
- R4. AGENTS link to KB validation ladder; do not add stack-bootstrap to `trask:gate`.

## Verification

```bash
pnpm trask:gate
```
