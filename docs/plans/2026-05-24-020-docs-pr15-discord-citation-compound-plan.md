---
title: "docs: PR #15 Discord dual-citation compound doc + verify gates"
type: docs
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-019-fix-discord-citation-line-filter-plan.md
pr: https://github.com/OpenKotOR/community-bots/pull/15
---

# PR #15 Discord Dual-Citation Compound Doc

## Summary

PR #15 fixed expert `/ask` queries failing `pnpm verify:trask-discord` with only one inline `https://` link after query-line filtering. Code and plan 019 are complete; this slice adds the durable **compound solution doc** (pattern from plan 018), a slash-contract cross-link, targeted unit tests for `ensureMinimumDistinctCitedLines`, and the standard verification gates.

---

## Problem Frame

Operators and agents see plan 019 as closed but lack a `docs/solutions/` entry for citation preservation — unlike defer-SLA (plan 018 → `trask-discord-ask-defer-sla-2026-05-24.md`). Without it, the next LFG or debug pass may re-investigate the same `filterDiscordLinesForQuery` regression.

---

## Requirements

- R1. Compound solution doc explains `ensureMinimumDistinctCitedLines`, `filterDiscordLinesForQuery`, and upstream `selectDistinctBriefClaims` with verification commands.
- R2. `trask-discord-slash-contract.md` links the new solution doc under Related.
- R3. Unit tests cover edge cases: backfill after aggressive filter, single-cited pool unchanged, distinct `[n]` index requirement.
- R4. `node --test packages/trask/dist/discord-reply-format.test.js` passes after build.
- R5. `pnpm trask:stack:health` and Holocron `:4010` smoke pass when stack is up.
- R6. `pnpm verify:trask-discord` passes when bot token + LLM + indexer are available; otherwise PR notes documented skip.

---

## Scope Boundaries

- Changing compose prompts or grounded claim extraction logic (landed in PR #15).
- Holocron full-profile line filtering.
- FileChunkStore merge epic (`docs/plans/2026-05-24-017-defer-filechunkstore-merge-plan.md`).
- Closing `trask-rag-discord-compose-requirements.md` (separate slice).

---

## Context & Research

### Relevant Code and Patterns

- `packages/trask/src/discord-reply-format.ts` — `ensureMinimumDistinctCitedLines`, `filterDiscordLinesForQuery`, `formatDiscordAskDisplay`
- `packages/trask/src/grounded-evidence.ts` — `selectDistinctBriefClaims`, `BRIEF_DISCORD_MIN_CITATIONS`
- `docs/solutions/tooling-decisions/trask-discord-ask-defer-sla-2026-05-24.md` — compound doc template
- `scripts/verify_trask_discord_live.mjs` — expert query gate

### Institutional Learnings

- Plan 019 documents the fix; no solutions entry yet.
- AGENTS.md Discord `/ask` pass criteria: ≥2 inline `[n](https://…)` citations, ≤5 lines.

---

## Key Technical Decisions

- **Docs-first closure:** Mirror plan 018 ship pattern without re-implementing PR #15 code.
- **Targeted unit tests:** Exercise `ensureMinimumDistinctCitedLines` directly via exported helpers or `formatDiscordAskDisplay` fixtures — no live Discord in unit tests.
- **Live gate optional:** Document skip when `TRASK_DISCORD_BOT_TOKEN` absent; do not block merge on credentials.

---

## Implementation Units

- U1. **Compound solution doc**

**Goal:** Durable operator/agent reference for citation preservation.

**Requirements:** R1

**Dependencies:** None

**Files:**
- Create: `docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md`

**Test expectation:** none — documentation.

**Verification:** Doc cross-links plan 019, PR #15, slash contract, and verify commands.

---

- U2. **Slash contract cross-link**

**Goal:** Discoverability from authoritative Discord contract.

**Requirements:** R2

**Dependencies:** U1

**Files:**
- Modify: `docs/knowledgebase/10-architecture-runtime/trask-discord-slash-contract.md`

**Test expectation:** none — documentation.

**Verification:** Related section includes new solution path.

---

- U3. **Unit tests for citation backfill**

**Goal:** Lock regression surface for expert-query line filtering.

**Requirements:** R3, R4

**Dependencies:** None

**Files:**
- Modify: `packages/trask/src/discord-reply-format.test.ts`

**Test scenarios:**
- Happy path: two cited lines with distinct `[1]`/`[2]` survive filter → ≥2 https links in display.
- Edge case: filter keeps one on-topic line; backfill adds second distinct cited line from pool.
- Edge case: pool has only one cited line → display still has one link (no fabrication).

**Verification:** `pnpm build && node --test packages/trask/dist/discord-reply-format.test.js` exit 0.

---

- U4. **Verification gates**

**Goal:** Confirm stack healthy and Discord live gate when credentials available.

**Requirements:** R5, R6

**Dependencies:** U3

**Files:** none (runtime)

**Verification:** Stack health curl OK; `verify:trask-discord` pass or skip documented in PR body.

---

## System-Wide Impact

- **Interaction graph:** Read-only docs + test additions; no runtime behavior change.
- **API surface parity:** Holocron unchanged; Discord brief profile only documented.
- **Unchanged invariants:** `formatDiscordAskDisplay` contract (≤5 lines, inline citations, no Sources block).

---

## Sources & References

- **Origin plan:** `docs/plans/2026-05-24-019-fix-discord-citation-line-filter-plan.md`
- **PR:** https://github.com/OpenKotOR/community-bots/pull/15
- **Pattern:** `docs/plans/2026-05-24-018-close-discord-ask-respond-plan-plan.md`
- **Contract:** `docs/knowledgebase/10-architecture-runtime/trask-discord-slash-contract.md`
