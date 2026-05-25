---
title: "feat(trask-config): harden goldenQueryId drift + arc #74 doc closeout"
type: feat
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-101-five-query-import-smoke-plan.md
---

# goldenQueryId drift hardening

## Requirements

- R1. Config-drift: expert question literal scan; CLI golden ↔ verification `goldenQueryId` bijection
- R2. Smoke-imports: 5/5 Discord compose parity
- R3. verification-queries tests: holocron linkage + unique goldenQueryId
- R4. Doc/PR template closeout (#66–#74, config-drift in answer-pipeline)

## Verification

```bash
pnpm trask:gate && pnpm trask:config-drift && pnpm trask:smoke-imports:ci
```
