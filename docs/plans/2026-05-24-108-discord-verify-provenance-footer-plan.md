---
title: "feat(trask): Discord verify provenance footer + arc doc sync"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-107-discord-provenance-footer-plan.md
---

# Discord verify provenance footer

## Inferred intent

- **Direct ask:** Enforce PR #80 footer in offline/live Discord verify gates; sync citation arc docs to **#33–#80**.
- **Adjacent impact:** `verify_trask_discord_live.mjs`, citation KB ladder, stack closeout table.
- **Cohesive scope:** Footer assert + doc arc only (no Holocron/browser).
- **Risks if partial:** Footer can regress without CI catching it.

## Requirements

- **R1.** `assertProvenanceFooter` in `verify_trask_discord_live.mjs` for import-smoke and live success paths.
- **R2.** Live: require `result.provenance` with `passagesCount >= 1` and truthy `indexerUrl`.
- **R3.** Evidence report includes footer line on PASS rows.
- **R4.** Arc docs cite **PR #33–#80**; closeout rows for #79–#80.
- **R5.** `pnpm trask:gate` unchanged (composite_score ≥ 165).

## Verification

```bash
pnpm build && pnpm trask:gate
TRASK_SKIP_BUILD=1 node --import tsx/esm scripts/verify_trask_discord_live.mjs --import-smoke
pnpm trask:verify-import-smoke:ci
```
