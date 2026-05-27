---
title: "feat(holocron): failure-path Playwright e2e (Plan 006 U6)"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-006-feat-trask-research-quality-bar-v1-plan.md
---

# Holocron failure-path Playwright e2e

## Inferred intent

- **Direct ask:** Automate Plan 006 U6 error path — broken indexer → failed UX + classifiable `liveTrace`.
- **Adjacent impact:** `holocron-e2e-webserver.mjs`, CI holocron job, validation ladder.
- **Cohesive scope:** One failure spec + failure Playwright config; no happy-path changes.
- **Risks if partial:** Failure regressions only caught manually.

## Requirements

- **R1.** `HOLOCRON_E2E_FAILURE_MODE=1` points `TRASK_INDEXER_BASE_URL` at unreachable port; skips QA stack bootstrap.
- **R2.** `holocron-research-failure.spec.ts` asserts `groundingStatus: failed`, failure `liveTrace` diag, failed Thought process icon path.
- **R3.** `holocron:e2e:playwright` runs happy then failure configs.
- **R4.** Five-query happy-path suite unchanged.

## Verification

```bash
node scripts/holocron-e2e-live-build.mjs
pnpm exec playwright test --config apps/holocron-web/playwright.failure.config.ts
```
