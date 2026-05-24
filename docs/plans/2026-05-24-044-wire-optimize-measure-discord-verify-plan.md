---
title: "feat: preflight Discord live verify with trask:optimize-measure"
type: feat
status: completed
date: 2026-05-24
merged: 99085e1
pr: https://github.com/OpenKotOR/community-bots/pull/28
origin: docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md
---

# Wire Optimize Measure Into Discord Live Verify

## Summary

`pnpm verify:trask-discord` currently runs `pnpm build` then live LLM/indexer calls. Fail citation-format regressions earlier by running `pnpm trask:optimize-measure` first (faithfulness + discord stress tests). Also point `scripts/experiment-worktree.sh` default base branch at `main` instead of stale `optimize/trask-citation-alignment`.

---

## Requirements

- R1. `verify:trask-discord` and `verify:trask-discord:post` run `pnpm trask:optimize-measure` before the live script (drop redundant standalone `pnpm build`).
- R2. `scripts/verify_trask_discord_live.mjs` header documents the preflight gate.
- R3. `docs/trask-ops.md` mentions optimize-measure before live Discord verify.
- R4. `scripts/experiment-worktree.sh` default `BASE_BRANCH` is `main`.
- R5. `pnpm trask:optimize-measure` passes locally.

---

## Scope Boundaries

- Changing live Discord pass criteria.
- Holocron e2e.

---

## Implementation Units

- U1. `package.json` verify scripts.
- U2. verify script + trask-ops doc.
- U3. experiment-worktree default branch.
- U4. PR + ship record.

---

## Authority path

`docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md`
