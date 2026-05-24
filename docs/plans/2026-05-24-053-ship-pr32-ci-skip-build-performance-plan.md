---
title: "ship: merge PR #32 CI skip-build performance"
type: ship
status: completed
date: 2026-05-24
merged: 018bb05
origin: docs/plans/2026-05-24-052-ci-trask-skip-build-performance-plan.md
pr: https://github.com/OpenKotOR/community-bots/pull/32
---

# Ship PR #32 — CI Skip-Build Performance

## Summary

Squash-merged PR #32. `TRASK_SKIP_BUILD` and optimize skip envs remove redundant `tsc -b` and duplicate unit/check runs in CI after the first `pnpm build`.

---

## Authority path

`docs/plans/2026-05-24-052-ci-trask-skip-build-performance-plan.md`
