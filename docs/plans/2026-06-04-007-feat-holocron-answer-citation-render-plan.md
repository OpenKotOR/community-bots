# Plan: Holocron answer citation rendering

**Status:** completed  
**Branch:** `feat/holocron-topnav-ci-followup`

## Problem

Holocron assistant messages showed raw markdown (`[label] (https://…)`) in answer paragraphs, numbered bibliography lines duplicated in the body when the model omitted a `Sources` heading, and broken `githubusercontent` image links from passage text.

## Approach

1. **Client** (`apps/holocron-web/src/lib/answer-presentation.ts`): tolerate whitespace in markdown links, strip images, peel embedded `1.` bibliography blocks, sanitize visible paragraphs while preserving `[n]` markers.
2. **Server** (`packages/trask/src/grounded-evidence.ts`): allow optional whitespace in `stripMarkdownArtifacts` regex.
3. **Tests:** `scripts/answer_presentation.test.mjs`, `grounded-evidence.test.ts` brief-profile markdown case.

## Verification

- `node --import tsx/esm --test scripts/answer_presentation.test.mjs`
- `pnpm build && node --test packages/trask/dist/grounded-evidence.test.js`
- Restart `trask_live_stack.sh`, browser MCP reone canonical query on `:4010`
