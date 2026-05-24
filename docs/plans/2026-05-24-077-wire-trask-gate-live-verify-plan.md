---
title: "feat: wire trask:gate into live-verify preflights"
type: feat
status: active
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-citation-stack-closeout-2026-05-24.md
---

# Wire trask:gate Into Live-Verify Preflights

## Summary

PR #49 added `pnpm trask:gate` (build + full + CI optimize-measure). Live Holocron/Discord verification scripts still preflight with `pnpm trask:optimize-measure` only, so a contributor can pass CLI/Discord preflight while missing the CI-equivalent `:ci` floor. Align package scripts and the validation ladder KB doc with the closeout ladder.

## Requirements

- R1. `package.json`: `verify:trask-cli`, `verify:trask-discord`, `verify:trask-discord:post`, and `holocron:e2e` run `pnpm trask:gate` instead of `pnpm trask:optimize-measure` as their offline preflight.
- R2. `docs/knowledgebase/50-execution/validation-ladder.md` documents `pnpm trask:gate` as the recommended offline preflight before live verify / e2e.
- R3. `docs/solutions/tooling-decisions/trask-citation-stack-closeout-2026-05-24.md` notes live scripts use `trask:gate`.
- R4. `pnpm trask:gate` exits 0 (composite_score **165** on both measure runs).

## Scope Boundaries

- No CI workflow change (already runs build + `trask:optimize-measure:ci`).
- No live Discord or Holocron browser runs in this PR.

## Implementation Units

| Unit | Files | Notes |
|------|-------|-------|
| Scripts | `package.json` | Four script string updates |
| KB | `docs/knowledgebase/50-execution/validation-ladder.md` | Section 3 ladder text |
| Compound | `docs/solutions/tooling-decisions/trask-citation-stack-closeout-2026-05-24.md` | Verification ladder bullet |

## Test Scenarios

- TS-1: `pnpm trask:gate` → exit 0, JSON lines show `composite_score` 165 for full and ci runs.
- TS-2: `grep` package.json shows `trask:gate` on verify and holocron:e2e scripts.

## Verification

```bash
pnpm trask:gate
```
