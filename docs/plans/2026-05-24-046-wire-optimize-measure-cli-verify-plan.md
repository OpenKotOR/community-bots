---
title: "feat: preflight CLI verify with trask:optimize-measure"
type: feat
status: completed
date: 2026-05-24
merged: b65e0f0
pr: https://github.com/OpenKotOR/community-bots/pull/29
origin: docs/plans/2026-05-24-044-wire-optimize-measure-discord-verify-plan.md
---

# Wire Optimize Measure Into CLI Verify

## Summary

PR #28 added `pnpm trask:optimize-measure` before `verify:trask-discord`. Apply the same preflight to `pnpm verify:trask-cli` so Holocron/CLI golden-query runs fail fast on faithfulness and citation stress regressions.

---

## Requirements

- R1. `verify:trask-cli` runs `pnpm trask:optimize-measure` before `verify_trask_cli_qa.mjs` (drop redundant `pnpm build`).
- R2. `scripts/verify_trask_cli_qa.mjs` header documents preflight.
- R3. `docs/trask-ops.md` and `docs/trask-research-backends.md` mention CLI preflight.
- R4. `pnpm trask:optimize-measure` passes locally.
- R5. ce-code-review: `Residual actionable work: none.`

---

## Scope Boundaries

- `pnpm holocron:e2e` (separate Playwright gate).
- Live Discord verify (already wired in PR #28).

---

## Implementation Units

- U1. `package.json` + verify script header.
- U2. Operator docs.
- U3. PR + ship record.

---

## Authority path

`docs/plans/2026-05-24-044-wire-optimize-measure-discord-verify-plan.md`
