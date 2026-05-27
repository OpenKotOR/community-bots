---
title: "feat(trask): Discord /ask provenance embed footer"
type: feat
status: completed
date: 2026-05-24
origin: docs/brainstorms/2026-05-19-trask-research-quality-bar-requirements.md
---

# Discord /ask provenance footer

## Inferred intent

- **Direct ask:** Close Plan 006 open question — one-line retrieve provenance on Discord without breaking ≤5-line body contract.
- **Adjacent impact:** `ResearchWizardBriefAnswer`, `discord-reply-format`, trask-bot embed builder, slash contract doc.
- **Cohesive scope:** Footer only (not description); success path only.
- **Risks if partial:** Operators still cannot see passage count / indexer from Discord alone.

## Requirements

- **R1.** `answerQuestionBrief` returns `provenance: { passagesCount, indexerUrl }` from retrieve payload.
- **R2.** `formatDiscordProvenanceFooter` → e.g. `12 passages · indexer 8787` (localhost shows port).
- **R3.** `buildResearchEmbed` passes footer via `buildInfoEmbed({ footer })`; timeout/failure keep default footer.
- **R4.** Unit tests + KB contract update.
- **R5.** `pnpm trask:gate` composite_score 165.

## Verification

```bash
pnpm build && pnpm trask:gate
node --test packages/trask/dist/discord-reply-format.test.js
pnpm trask:verify-import-smoke:ci
```
