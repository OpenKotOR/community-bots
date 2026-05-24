---
title: "refactor: extract research-answer-split module"
type: refactor
status: active
date: 2026-05-24
origin: docs/knowledgebase/10-architecture-runtime/trask-citation-display-contract.md
---

# Extract research-answer-split Module

## Summary

Break `grounded-evidence` ↔ `discord-reply-format` import cycle by moving `splitResearchAnswer` and `syncSourcesSectionToApproved` (and Sources-section helpers) into `packages/trask/src/research-answer-split.ts`. Re-export from `discord-reply-format.ts` for script compatibility.

## Requirements

- R1. New `research-answer-split.ts` with `ResearchAnswerSource`, `splitResearchAnswer`, `syncSourcesSectionToApproved` — no imports from `grounded-evidence` or `discord-reply-format`.
- R2. `grounded-evidence.ts` imports from `research-answer-split.ts` only (not `discord-reply-format`).
- R3. `discord-reply-format.ts` imports split/sync from `research-answer-split`; re-exports for backward compat.
- R4. Update `research-wizard.ts`, `proactive-llm.ts`, `grounded-evidence.test.ts`, `scripts/trask_faithfulness_eval.mjs`, `scripts/verify_trask_cli_qa.mjs`.
- R5. `pnpm trask:optimize-measure` composite_score **165**.
- R6. Update KB citation display contract: cycle resolved.

## Scope Boundaries

- Moving `buildCitationUrlMap` or URL parsers (stay in discord-reply-format).
- Package index exports.

## Verification

`pnpm build && pnpm trask:optimize-measure`
