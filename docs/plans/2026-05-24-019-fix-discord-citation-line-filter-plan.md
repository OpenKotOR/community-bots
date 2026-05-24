---
title: "fix: Preserve ≥2 Discord inline citations after query line filter"
type: fix
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-018-close-discord-ask-respond-plan-plan.md
---

# fix: Preserve ≥2 Discord Inline Citations After Query Line Filter

## Summary

`pnpm verify:trask-discord` fails expert queries with `only 1 inline https link(s); need ≥2` even when the raw brief answer contains two `[1]`/`[2]` lines. `filterDiscordLinesForQuery` in `discord-reply-format.ts` over-filters cited lines for query relevance and drops the second citation before `embedInlineCitationLinks` runs.

---

## Problem Frame

Golden queries often pass; expert phrasing triggers aggressive `scoreAndFilterLines` pruning that keeps one high-scoring line and removes another valid cited line. `approvedSources` still has ≥2 entries, but the Discord embed display ends up with one `https://` link — violating AGENTS.md and `verify_trask_discord_live.mjs` gates.

---

## Requirements

- R1. When the input body has ≥2 lines with distinct citation markers, `formatDiscordAskDisplay` must emit ≥2 inline `https://` links (unless `approvedSources` has fewer than 2 https URLs).
- R2. Query relevance filtering may still drop off-topic lines, but must not reduce distinct cited lines below `BRIEF_DISCORD_MIN_CITATIONS` when the pool supports it.
- R3. Unit tests cover the expert TSLPatcher fixture (two-line raw answer → two linked citations).
- R4. `pnpm verify:trask-discord` passes all expert verification queries with stack + LLM up.

---

## Scope Boundaries

- Changing LLM compose prompts or grounded compose claim selection.
- Holocron full-profile line filtering (Discord brief only).
- FileChunkStore merge epic.

---

## Key Technical Decisions

- **Pad after filter, don't disable filter:** Keep `scoreAndFilterLines` for anti-catalog-dump behavior; after filtering, backfill from the cited pool until distinct citation indices ≥ `BRIEF_DISCORD_MIN_CITATIONS`.
- **Distinct citation indices:** Prefer lines whose `[n]` markers add a new index not already in the selected set.

---

## Implementation Units

- U1. **Minimum citation preservation in line filter**

**Goal:** Fix `filterDiscordLinesForQuery` to preserve ≥2 distinct cited lines when available.

**Requirements:** R1, R2

**Dependencies:** None

**Files:**
- Modify: `packages/trask/src/discord-reply-format.ts`
- Test: `packages/trask/src/discord-reply-format.test.ts`

**Test scenarios:**
- Happy path: two-line expert TSLPatcher raw body + query → display has 2 `](https://` links.
- Edge case: single cited line in pool → unchanged (still 1 link).
- Edge case: off-topic third line with [3] not required when [1] and [2] kept.

**Verification:** Repro script and unit tests pass.

---

- U2. **Live Discord verify gate**

**Goal:** Confirm expert queries pass end-to-end.

**Requirements:** R4

**Dependencies:** U1

**Files:** none

**Verification:** `pnpm verify:trask-discord` exit 0.

---
