---
title: "ci: use pnpm trask:optimize-measure:ci in workflow"
type: fix
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-072-trask-optimize-measure-ci-script-plan.md
---

# CI Uses trask:optimize-measure:ci Script

## Summary

PR #45 added `pnpm trask:optimize-measure:ci` but `.github/workflows/ci.yml` still sets `TRASK_OPTIMIZE_CI_MODE` manually. Switch the workflow to the script and align KB/AGENTS wording to the script name.

## Requirements

- R1. `.github/workflows/ci.yml` runs `pnpm trask:optimize-measure:ci` (no redundant env block).
- R2. Sync `AGENTS.md`, `validation-ladder.md`, `answer-pipeline.md`, `trask-indexed-stack-runbook.md` to reference `:ci` script for CI path.
- R3. `pnpm trask:optimize-measure:ci` passes with composite_score **165**.

## Scope Boundaries

- Changing optimize measure logic.
- Live Discord/Holocron runs.

## Verification

`pnpm trask:optimize-measure:ci`
