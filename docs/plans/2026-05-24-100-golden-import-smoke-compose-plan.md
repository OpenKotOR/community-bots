---
title: "feat(verify): composeGoldenCliAnswer from golden fixtures"
type: feat
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-099-trask-config-companion-fixture-qa-webui-plan.md
---

# Golden Import-Smoke Compose Dedup

## Summary

Replace duplicated `IMPORT_SMOKE_FIXTURES` literals with `composeGoldenCliAnswer(getGoldenQuery)` now that `companionFixture` parses. Sync arc **#33–#73**.

## Requirements

- R1. `scripts/lib/compose_golden_cli_answer.mjs`
- R2. Refactor CLI + Discord import-smoke; narrow config-drift allowlist
- R3. Smoke-imports asserts; arc docs **#33–#73**
- R4. Compound doc `trask-golden-import-smoke-compose-2026-05-24.md`

## Verification

```bash
pnpm trask:gate && pnpm verify:trask-cli:ci && pnpm verify:trask-discord:ci
```
