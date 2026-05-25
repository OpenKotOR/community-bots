---
module: trask
tags: [trask, qa, golden-queries, ci, import-smoke]
problem_type: tooling-decision
date: 2026-05-24
pr: 74
---

# Golden import-smoke compose helper

## Problem

`verify_trask_cli_qa.mjs` and `verify_trask_discord_live.mjs` duplicated CLI-shaped answers from `golden-queries.json`, forcing `check_trask_config_drift.mjs` to allowlist those scripts after PR #72 added `companionFixture` to Zod.

## Solution

`scripts/lib/compose_golden_cli_answer.mjs` builds answers from `getGoldenQuery(id)` (primary + companion markdown, `Sources` block, host labels). CI import-smoke covers **all five** canonical queries:

- CLI: `GOLDEN_IMPORT_SMOKE_IDS` from `goldenQueriesForSurface("cli")`
- Discord: `DISCORD_IMPORT_SMOKE_SPECS` from `verificationQueriesForSurface("discord")` + `goldenQueryId` in `verification-queries.json`

`trask_smoke_package_imports.mjs` asserts compose output shape for all five CLI and Discord paths. `check_trask_config_drift.mjs` scans expert verification question literals and enforces a 1:1 match between CLI golden ids and `goldenQueryId` (PR #75).

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
