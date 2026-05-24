---
title: "Trask Discord dual-citation line filter preservation"
date: 2026-05-24
last_refreshed: 2026-05-24
category: tooling-decisions
problem_type: quality
component: trask
module: trask
tags:
  - "trask"
  - "discord"
  - "citations"
  - "verify-trask-discord"
applies_when: "pnpm verify:trask-discord fails expert queries with only 1 inline https link despite raw answer having [1] and [2]"
---

## Context

Discord `/ask` uses a **brief** display profile: ≤5 lines, inline `[n](https://…)` citations, no `Sources` block. After grounded compose, `formatDiscordAskDisplay` runs query relevance filtering via `filterDiscordLinesForQuery` so embeds do not become catalog dumps.

Expert phrasing (e.g. TSLPatcher toolchain questions) can score one cited line much higher than another. Aggressive `scoreAndFilterLines` pruning kept a single on-topic line and dropped the second valid citation before `embedInlineCitationLinks`, causing `pnpm verify:trask-discord` to fail with `only 1 inline https link(s); need ≥2` even when the raw brief answer contained two distinct markers.

PR #15 fixed this by backfilling from the cited pool after filtering.

## Root cause

1. **`filterDiscordLinesForQuery`** kept only the top-scoring cited line for expert phrasing, dropping the second citation before `embedInlineCitationLinks`.
2. **`selectDistinctBriefClaims`** / **`claimsFromDistinctPassages`** could pad with off-topic token matches, causing catalog bleed on some queries.

## Solution

1. **`ensureMinimumDistinctCitedLines`** — After query scoring selects lines, backfill from the cited pool until distinct `[n]` indices ≥ `BRIEF_DISCORD_MIN_CITATIONS` (2), preferring lines that add a new citation index.
2. **`filterDiscordLinesForQuery`** — When ≥2 cited lines exist, run scoring on cited lines only, then call `ensureMinimumDistinctCitedLines` so anti-dump filtering does not collapse citation count.
3. **Upstream compose** — `selectDistinctBriefClaims` in `grounded-evidence.ts` prefers query-anchored claims before lines reach the formatter (reduces off-topic padding).

Implementation: `packages/trask/src/discord-reply-format.ts` (`ensureMinimumDistinctCitedLines`, `sliceLinesPreservingDistinctCitations`, exported `citationIndicesInLines` / `citationIndicesInText` for tests). Tests: `packages/trask/src/discord-reply-format.test.ts` (import production helpers — no duplicate citation regex).

## Verification

```bash
pnpm build
pnpm trask:optimize-measure   # composite_score ≥ 115, 8 discord stress tests, faithfulness 5/5
node --test packages/trask/dist/discord-reply-format.test.js
pnpm trask:stack:health
pnpm verify:trask-discord   # when TRASK_DISCORD_BOT_TOKEN + LLM + indexer up
```

Pass criteria (expert queries): ≥2 distinct inline `https://` links, ≤5 non-empty lines, no `Sources` heading in embed.

## Related

- `docs/plans/2026-05-24-019-fix-discord-citation-line-filter-plan.md`
- `docs/knowledgebase/10-architecture-runtime/trask-discord-slash-contract.md`
- `docs/solutions/tooling-decisions/trask-discord-ask-defer-sla-2026-05-24.md`
- https://github.com/OpenKotOR/community-bots/pull/15

## History

- 2026-05-24 — PR #26 (`4935482`) exported `citationIndicesInLines` / `citationIndicesInText`; tests use production `CITATION_INDEX_CAPTURE_RE` (no duplicate helpers).
- 2026-05-24 — PR #25 (`5455582`) maintainability: `CITATION_MARKER_IN_LINE_RE` vs `CITATION_INDEX_CAPTURE_RE` split; `sliceLinesPreservingDistinctCitations` uses `citationIndicesInLines` for distinctness.
- 2026-05-24 — PR #24 (`85a66fd`) added `swapWeakOffTopicCitedLines`, `sliceLinesPreservingDistinctCitations`, clamp backfill when line caps drop a second citation, and `scripts/trask_optimize_measure.mjs` (+ `pnpm trask:optimize-measure`) for ce-optimize gates (`composite_score` 115, 8 discord stress tests).
- 2026-05-24 — Documented after PR #15 merge (`ensureMinimumDistinctCitedLines` + claim selection hardening).
