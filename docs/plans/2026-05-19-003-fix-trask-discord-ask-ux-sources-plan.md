---
title: "fix: Trask Discord /ask — compact replies and relevant citations"
type: fix
status: completed
date: 2026-05-19
origin: docs/brainstorms/trask-rag-discord-compose-requirements.md
supersedes-partially: docs/plans/2026-05-19-002-fix-trask-discord-ask-respond-plan.md
---

# fix: Trask Discord /ask — compact replies and relevant citations

## Summary

Discord `/ask` now acknowledges interactions reliably (see plan 002), but replies are still too long, expose a separate **Sources** embed field, and often cite shallow catalog roots instead of the deep pages the indexer actually retrieved. This plan finishes the Discord presentation layer (≤5 lines, linked `[n]` citations only), tightens evidence selection so tooling queries prefer on-topic deep URLs, routes `/ask` through the brief compose profile, and adds acceptance checks that prove three diverse golden questions in Discord (or an equivalent scripted gate) before calling the fix done.

---

## Problem Frame

Operators and members in `#discord-bot-testing` see **Trask Ulgo Briefing** embeds that read like mini essays with a **Sources** field listing generic forum homepages. The product intent for Discord (actor **A2** in the RAG requirements) is a quick, cited DM-style answer — not a Holocron-length report. Holocron may keep full Sources panels; Discord must not.

**Partially landed (same day):** `formatDiscordAskDisplay` in `packages/trask/src/discord-reply-format.ts`, rerank tweaks in `research-wizard.ts`, and `buildResearchEmbed` wiring in `apps/trask-bot/src/main.ts`. This plan completes verification, closes source-URL gaps, and switches `/ask` to the brief compose path.

---

## Requirements

- R1. Discord `/ask` embed **description** is at most **5 non-empty lines** (no separate Sources embed fields).
- R2. Citations appear only as inline markdown links on the number: `[1](https://…)` — users do not see a numbered Sources list in the embed.
- R3. Citation URLs must be the **deep retrieved page** when available (e.g. `kotor.neocities.org/modding/tslpatcher/`), not bare catalog roots (`https://deadlystream.com/`) when a deeper allowlisted URL exists in evidence.
- R4. Tooling/technical queries prefer modding/reference sources over lore wikis in retrieved and cited source ordering (extends existing `routeSourcesForQuery` / rerank behavior with tests).
- R5. `/ask` uses the **brief** research compose profile (same retrieve path, shorter LLM prompts / grounded compose instructions) — Holocron HTTP remains on the full profile.
- R6. Unit tests cover `formatDiscordAskDisplay` (line clamp, link embedding, Sources stripping) and source URL materialization for deep vs shallow URLs.
- R7. **Done gate:** three diverse golden questions each produce a substantive briefing with ≥2 distinct linked citations and no “application did not respond” — verified via browser on `#discord-bot-testing` or a documented operator script with screenshot evidence under `docs/evidence/`.
- R8. `pnpm verify:trask-cli` and `pnpm holocron:e2e` remain green (shared backend unchanged in contract).

**Origin actors:** A2 (Discord `/ask` user), A3 (operator)

**Origin flows:** F2 (retrieve-first Q&A), F3 (Discord at query time)

**Origin acceptance examples:** AE-1 (question-last compose — Holocron); Discord UX in this plan extends AE-1 with R1–R2 for presentation only.

---

## Scope Boundaries

- Holocron UI layout and Sources panel behavior (unchanged).
- New Crawl4AI ingest features or Discord auto-sync defaults (see RAG plan).
- CI jobs that require a live Discord bot token.
- Proactive handler reply formatting (may reuse helpers later; not in this plan).

### Deferred to Follow-Up Work

- `infra/trask-bot-stack/` always-on VPS compose (operator deploy) — separate infra plan when remote hosting is ready.
- Automated Playwright against Discord in CI — blocked on secrets; local/browser gate only for R7.

---

## Context & Research

### Relevant Code and Patterns

- `apps/trask-bot/src/main.ts` — `handleAskCommand`, `buildResearchEmbed` (should call `formatDiscordAskDisplay` only).
- `packages/trask/src/discord-reply-format.ts` — display formatter (landed).
- `packages/trask/src/research-wizard.ts` — `answerQuestion`, `answerQuestionBrief`, `materializeSourcesFromUrls`, `collectWebEvidenceSources`, `rewriteForDiscord*`.
- `packages/trask/src/grounded-evidence.ts` — `composeGroundedAnswerWithLlm`, `collectCitedSourcesFromAnswer`.
- `scripts/verify_trask_cli_qa.mjs` — golden queries with `sourcePattern` per question.

### Institutional Learnings

- Plan 002: “application did not respond” = missing defer / bot offline — not slow research.
- AGENTS.md: do not claim Holocron/Trask working without runtime proof; Discord needs its own gate for `/ask`.

### External References

- Discord embed description markdown: `[label](url)` for inline links ([Discord API — embeds](https://discord.com/developers/docs/resources/channel#embed-object)).

---

## Key Technical Decisions

- **Presentation vs compose separation:** Keep internal `Sources\n1. Name - URL` blocks for parsing; strip and link only at Discord embed build time via `formatDiscordAskDisplay` (see origin RAG compose requirements — compose contract unchanged for Holocron).
- **Brief profile for Discord:** Call `researchWizard.answerQuestionBrief(query)` from `handleAskCommand` (or add `options.composeProfile: 'discord'` that maps to the same prompts) so LLM output is short before formatting (R5).
- **Deep URL citations:** After compose, rebuild the Sources section from citation indices using `approvedSources` whose `homeUrl` is already resolved to deep URLs via `exactSourceFromUrl`; extend `collectWebEvidenceSources` to merge `payload.passages[].url` ahead of catalog roots (R3).
- **Acceptance split:** R6–R8 automated in Node; R7 manual/browser with evidence artifact — matches STRATEGY.md Discord reliability track.

---

## Open Questions

### Resolved During Planning

- **Use separate plan vs extend 002?** New plan `003` — 002 is SLA/defer; this is UX/sources.
- **Holocron citation policy?** Unchanged (≥2 https in Sources panel per R-14/R-15).

### Deferred to Implementation

- Whether `answerQuestionBrief` alone is sufficient or grounded compose needs a dedicated `maxLines: 5` system prompt when passages exist — validate against golden queries during U3.

---

## Implementation Units

- U1. **Discord display formatter (finish + test)**

**Goal:** Lock R1–R2 with tests and ensure bot uses only the formatter for embed body.

**Requirements:** R1, R2, R6

**Dependencies:** None

**Files:**
- Modify: `packages/trask/src/discord-reply-format.ts`
- Modify: `apps/trask-bot/src/main.ts`
- Test: `packages/trask/src/discord-reply-format.test.ts`

**Approach:**
- Confirm `buildResearchEmbed` has **no** `Sources` embed fields; description-only embed.
- Harden clamping for grounded-compose artifacts (`Answer for:`, inline `# headings`).
- Export constants `DISCORD_ASK_MAX_BODY_LINES` for docs/runbook.

**Test scenarios:**
- Happy path: answer with Sources block → output ≤5 lines, `[1](url)` present, no `Sources` heading in output.
- Edge case: single 2k-char paragraph → split/clamp to ≤5 lines.
- Edge case: citation index without URL in map → bare `[n]` preserved.

**Verification:** `node --test packages/trask/dist/discord-reply-format.test.js` passes.

---

- U2. **Deep URL source materialization**

**Goal:** Citation links and Sources parsing prefer retrieved passage URLs over shallow roots (R3).

**Requirements:** R3, R4, R6

**Dependencies:** U1

**Files:**
- Modify: `packages/trask/src/research-wizard.ts`
- Test: `packages/trask/src/research-wizard.test.ts`

**Approach:**
- In `collectWebEvidenceSources`, prepend URLs from `payload.passages` (ranked) before report-derived URLs.
- Ensure `materializeSourcesFromUrls` drops shallow roots when any deep allowlisted URL exists (behavior exists — add regression tests for TSLPatcher + neocities path).
- When aligning `approvedSources` for return value, preserve per-citation `homeUrl` from materialized deep URLs.

**Test scenarios:**
- Happy path: pool contains `https://deadlystream.com/` and `https://kotor.neocities.org/modding/tslpatcher/` → latter retained, root dropped.
- Happy path: `exactSourceFromUrl` sets `homeUrl` to deep path for catalog match.
- Edge case: only shallow roots available → still return up to 2 roots (degraded, not empty).

**Verification:** Research wizard unit tests pass; manual check that Sources lines in raw answer contain `/modding/tslpatcher` for TSLPatcher query.

---

- U3. **Brief compose profile for `/ask`**

**Goal:** Research pipeline generates ≤5-line bodies before Discord formatting (R5).

**Requirements:** R5

**Dependencies:** U2

**Files:**
- Modify: `apps/trask-bot/src/main.ts`
- Modify: `packages/trask/src/research-wizard.ts`
- Modify: `packages/trask/src/grounded-evidence.ts` (optional brief prompt branch)

**Approach:**
- Switch `handleAskCommand` to `answerQuestionBrief` **or** pass `composeProfile: 'discord'` into `answerQuestion` that selects brief prompts and lower `max_tokens`.
- Align `composeGroundedAnswerWithLlm` Discord branch: max 5 lines, no markdown headings, question-last preserved.
- Tighten `rewriteForDiscord` / `rewriteForDiscordBrief` prompts to match R1 (already partially done).

**Test scenarios:**
- Happy path: mock or fixture compose returns body with ≤5 lines before `formatDiscordAskDisplay`.
- Integration: `verify_trask_cli_qa` golden row for TSLPatcher — `sourcePattern` matches neocities or deadlystream **topic** URL, not bare domain only.

**Verification:** `pnpm verify:trask-cli` passes all five golden queries.

---

- U4. **CLI verifier — Discord-shaped output checks**

**Goal:** Catch regressions without opening Discord (R6, R8).

**Requirements:** R6, R8

**Dependencies:** U1, U3

**Files:**
- Modify: `scripts/verify_trask_cli_qa.mjs`
- Optional: `packages/trask/src/discord-reply-format.ts` (import display helper)

**Approach:**
- After `answerQuestionBrief`, run `formatDiscordAskDisplay` on result.
- Assert line count ≤5, no `/\nSources\n/i` in display string, ≥2 distinct `https://` URLs inside `](https://` link targets.
- Strengthen `sourcePattern` checks to reject answers whose only URLs are bare host roots when a deeper pattern is expected.

**Test scenarios:**
- Happy path: all DEFAULT_QUERIES pass new display assertions.
- Error path: degraded synthesis message still renders without throwing.

**Verification:** `pnpm verify:trask-cli` exit 0.

---

- U5. **Discord live acceptance gate**

**Goal:** Satisfy R7 — three diverse `/ask` answers in the real channel.

**Requirements:** R7

**Dependencies:** U1–U4, plan 002 (bot running + defer)

**Files:**
- Create: `docs/evidence/2026-05-19-discord-ask-ux-proof.md` (or `.png` screenshot + short log)
- Modify: `docs/trask-ops.md`, `docs/knowledgebase/10-architecture-runtime/trask-discord-slash-contract.md`

**Approach:**
- With indexer seeded (`scripts/trask_index_seed_for_qa.sh`) and `trask-bot` online, run three queries in `#discord-bot-testing`:
  1. What is TSLPatcher used for in KOTOR modding?
  2. How do I troubleshoot KOTOR widescreen resolution on PC?
  3. What does the reone project provide for Odyssey engine work?
- Pass: immediate defer/thinking, then briefing ≤5 lines, linked `[n]`, on-topic content, no “application did not respond”.
- Capture screenshot or transcript in `docs/evidence/`.

**Test expectation:** none — manual/browser acceptance.

**Verification:** Evidence file committed or attached to PR; operator sign-off in PR description.

---

## System-Wide Impact

- **Interaction graph:** `apps/trask-bot` `/ask` only; Holocron uses full `answerQuestion` unless later opted in.
- **Error propagation:** Timeouts still use short `buildInfoEmbed` message; formatter not applied to failure strings.
- **API surface parity:** `trask-http-server` and Holocron e2e unchanged.
- **Unchanged invariants:** MIN_HOLOCRON_WEB_CITATIONS, no `discord://` in public Holocron Sources (R-15).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Brief compose drops citation count below 2 | Keep fallback `sourceOnlyFallbackAnswer`; CLI verifier enforces ≥2 linked https |
| Indexer returns no deep URLs | Seed QA corpus; abstain rather than link bare roots when shallow-only |
| Browser gate flaky | Document scripted alternative; retry with bot restart checklist in `docs/trask-ops.md` |

---

## Documentation / Operational Notes

- Update `docs/trask-ops.md` with Discord UX expectations (5 lines, inline citations).
- Cross-link plan 002 (defer/always-on) and this plan (UX/sources).

---

## Sources & References

- **Origin document:** `docs/brainstorms/trask-rag-discord-compose-requirements.md`
- **Prior fix:** `docs/plans/2026-05-19-002-fix-trask-discord-ask-respond-plan.md`
- **Strategy:** `STRATEGY.md` — Discord reliability track
- **Code:** `packages/trask/src/discord-reply-format.ts`, `apps/trask-bot/src/main.ts`, `packages/trask/src/research-wizard.ts`
