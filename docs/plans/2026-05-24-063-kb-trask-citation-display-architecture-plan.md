---
title: "docs: KB Trask citation display architecture"
type: docs
status: completed
date: 2026-05-24
origin: ai-architect + ce-architecture-strategist + kb-orchestrator synthesis
---

# KB Trask Citation Display Architecture

## Summary

Post PRs #33–#36, runtime citation policy lives in `citation-markers.ts` and `formatDiscordAskDisplay`, but KB lacks one architecture contract. Add `trask-citation-display-contract.md` and thin cross-links (runtime map, indexed-stack runbook, answer-pipeline). Docs-only slice; no package export or `splitResearchAnswer` extraction in this pass.

## Requirements

- R1. Create `docs/knowledgebase/10-architecture-runtime/trask-citation-display-contract.md` per kb-orchestrator outline (evidence labels, authority split vs solutions doc).
- R2. Link from `trask-runtime-map.md`, `trask-indexed-stack-runbook.md`, `answer-pipeline.md`.
- R3. Document known `[OPEN]` import cycle `grounded-evidence` ↔ `discord-reply-format`; do not export `citation-markers` from package index.
- R4. `pnpm trask:optimize-measure` still **165** (docs-only).
- R5. Ship via PR.

## Scope Boundaries

- Extracting `research-answer-split.ts` (Tier-2 code follow-up).
- Holocron browser e2e in this pass.

## Implementation Units

### U1. Companion KB doc

**Verification:** File exists; sections 1–8 from outline; composite_score cited by reference only.

### U2. Cross-links

**Verification:** runtime-map `lastUpdated` 2026-05-24; runbook gates table rows added.

### U3. Ship

**Verification:** PR merged; ship plan on `main`.
