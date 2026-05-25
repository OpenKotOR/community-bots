---
module: trask
tags: [trask, qa, golden-queries, ci, import-smoke]
problem_type: tooling-decision
date: 2026-05-24
pr: 73
---

# Golden import-smoke compose helper

## Problem

`verify_trask_cli_qa.mjs` and `verify_trask_discord_live.mjs` duplicated CLI-shaped answers from `golden-queries.json`, forcing `check_trask_config_drift.mjs` to allowlist those scripts after PR #72 added `companionFixture` to Zod.

## Solution

`scripts/lib/compose_golden_cli_answer.mjs` builds answers from `getGoldenQuery(id)` (primary + companion markdown, `Sources` block, host labels). CI import-smoke:

- CLI: `GOLDEN_IMPORT_SMOKE_IDS` (`tslpatcher`, `mdlops`)
- Discord: `DISCORD_IMPORT_SMOKE_SPECS` maps verification ids to golden ids with expert question overrides

`trask_smoke_package_imports.mjs` asserts compose output shape.

## Verification

```bash
pnpm trask:smoke-imports:ci
pnpm verify:trask-cli:ci
pnpm verify:trask-discord:ci
pnpm trask:config-drift
```

## Related

- [trask-qa-stack-bootstrap-2026-05-24.md](trask-qa-stack-bootstrap-2026-05-24.md)
- [trask-citation-stack-closeout-2026-05-24.md](trask-citation-stack-closeout-2026-05-24.md)
