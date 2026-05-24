---
title: "Trask Discord dual-citation line filter"
date: 2026-05-24
last_refreshed: 2026-05-24
category: tooling-decisions
problem_type: reliability
component: trask
module: trask
tags:
  - "trask"
  - "discord"
  - "citations"
  - "formatDiscordAskDisplay"
applies_when: "pnpm verify:trask-discord fails with only 1 inline https link on expert queries"
---

## Context

Expert Discord verification queries failed with `only 1 inline https link(s); need ≥2` even when the raw brief answer contained two `[1]`/`[2]` lines. Golden queries often passed because both lines survived query scoring.

## Root cause

1. **`filterDiscordLinesForQuery`** in `discord-reply-format.ts` kept only the top-scoring cited line for expert phrasing, dropping the second citation before `embedInlineCitationLinks`.
2. **`selectDistinctBriefClaims`** / **`claimsFromDistinctPassages`** padded with off-topic token matches (e.g. TSLPatcher line on save-game queries), causing catalog bleed.

## Solution

1. **`ensureMinimumDistinctCitedLines`** — after query scoring, backfill from the cited pool until ≥2 distinct `[n]` markers (query-anchored candidates only).
2. **Anchor-only claim selection** — remove off-topic token padding in `selectDistinctBriefClaims` and require `passageMatchesQueryAnchor` in passage token fallback.

## Verification

```bash
node --test packages/trask/dist/discord-reply-format.test.js
pnpm verify:trask-discord
```

## Related

- `docs/plans/2026-05-24-019-fix-discord-citation-line-filter-plan.md`
- `packages/trask/src/discord-reply-format.ts`
- `packages/trask/src/grounded-evidence.ts`
- PR #15

## History

- 2026-05-24 — Landed in PR #15; all five expert `verify:trask-discord` queries pass.
