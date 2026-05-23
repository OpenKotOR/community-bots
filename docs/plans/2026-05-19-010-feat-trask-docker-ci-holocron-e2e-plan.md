---
title: "feat: Trask HF Docker CI gate + Holocron e2e verification"
type: feat
status: completed
date: 2026-05-19
origin: docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md
predecessor: docs/plans/2026-05-19-009-feat-trask-hf-deploy-supervisor-plan.md
---

# Trask HF Docker CI gate + Holocron e2e verification

## Summary

Close PR #8 merge gaps: add **Docker Builds CI** coverage for `infra/trask-http-public/Dockerfile` (supervisor smoke), and run **Holocron functional e2e** against the live stack when available. Fix any failures blocking merge.

---

## Problem Frame

Plan 009 landed HF supervisor code but PR checklist still has unchecked `docker build` and `pnpm holocron:e2e`. Without CI for the HF image, supervisor regressions ship silently.

---

## Requirements

- R14. Operator repro — Docker build must pass in CI (origin)
- R16. Holocron e2e ladder (origin)

---

## Scope Boundaries

- Full catalog batch crawl at image build
- Restoring Trask unit tests
- BM25 sparse index

---

## Implementation Units

- U1. **Docker Builds CI for trask-http-public**

**Goal:** Build HF image and smoke-test indexer + HTTP inside container.

**Files:**
- Modify: `.github/workflows/docker-builds.yml`

**Verification:** Workflow step passes; local `docker build` optional

---

- U2. **Holocron e2e on live stack**

**Goal:** Run `pnpm holocron:e2e` with `HOLOCRON_REUSE_SERVER=1`; fix spec/runtime blockers if any.

**Files:** As needed from failures

**Verification:** All holocron verification queries pass

---

## Sources & References

- **Predecessor:** [docs/plans/2026-05-19-009-feat-trask-hf-deploy-supervisor-plan.md](./2026-05-19-009-feat-trask-hf-deploy-supervisor-plan.md)
