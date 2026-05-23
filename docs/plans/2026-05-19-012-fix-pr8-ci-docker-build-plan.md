---
title: "fix: Green CI for PR #8 HF Docker build"
type: fix
status: completed
date: 2026-05-19
origin: docs/plans/2026-05-19-011-fix-pr8-merge-main-conflicts-plan.md
predecessor: docs/plans/2026-05-19-011-fix-pr8-merge-main-conflicts-plan.md
---

# Green CI for PR #8 HF Docker build

## Summary

PR #8 is mergeable but **UNSTABLE** while CI runs. Validate the new **`trask-http-public` Docker build + smoke** step locally, fix build failures, and confirm main CI gates pass on `6f6cf1b`.

---

## Requirements

- R14. HF Docker repro builds in CI (plan 009/010)
- R16. `pnpm build`, faithfulness eval, holocron e2e remain green

---

## Scope Boundaries

- Merging PR #8 (user/merge button)
- Restoring Trask unit tests

---

## Implementation Units

- U1. **Local HF Docker build + smoke**

**Goal:** Reproduce Docker Builds CI step; fix Dockerfile/bootstrap failures.

**Files:** `infra/trask-http-public/Dockerfile`, bootstrap scripts as needed

**Verification:** Container serves :7860 and indexer :8790/health

---

- U2. **Fix CI failures if any**

**Goal:** Address failing jobs on PR #8 after push.

**Verification:** `gh pr checks 8` all green

---

## Sources

- `.github/workflows/docker-builds.yml` trask-http-public step
