---
title: "feat(trask): Holocron honest grounding UX (quality bar R4)"
type: feat
status: completed
date: 2026-05-24
origin: docs/brainstorms/2026-05-19-trask-research-quality-bar-requirements.md
---

# Holocron honest grounding UX

## Inferred intent

- **Direct ask:** Stop treating thin or abstaining answers as successful `partial` outcomes in Holocron.
- **Adjacent impact:** `inferGroundingStatus`, Holocron `Message.tsx`, e2e grounding assertion, script URL verify drift.
- **Cohesive scope:** Map abstention to `failed` in core inference; treat legacy `partial` as failed in UI; dedupe `url-verify.mjs` onto `@openkotor/trask`; fix module-arch related link to **#33–#78**.

## Requirements

- **R1.** `inferGroundingStatus` returns `failed` (not `partial`) for “could not support a grounded answer” abstention phrasing (quality bar **R4**).
- **R2.** Holocron UI: `partial` displays as **failed** (trace icon, banner, provenance label) — no yellow “limited citations” success path.
- **R3.** Holocron e2e expects `groundingStatus` ∈ `{ grounded, failed }` only.
- **R4.** `scripts/lib/url-verify.mjs` re-exports reachability helpers from `@openkotor/trask`; `assertAllUrlsReachable` lives in one place (`citation-url-verify.ts`).
- **R5.** Doc: module-arch related link cites **PR #33–#78**.

## Verification

```bash
pnpm build
pnpm trask:gate
pnpm holocron:e2e   # when stack + keys available; required before claiming Holocron done
```
