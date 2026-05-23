---
title: "fix: Restore Discord /ask within interaction SLA"
type: fix
status: active
date: 2026-05-19
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
---

# fix: Restore Discord /ask within interaction SLA

## Summary

Discord `/ask` is failing with “The application did not respond” because the interaction is not acknowledged within Discord’s ~3s window. This plan hardens the bot handler (defer before policy checks), adds unit coverage for defer/stale paths, documents always-on runtime requirements, and re-verifies the shared research stack with Holocron Playwright and `verify:trask-cli`.

---

## Problem Frame

Users in `#discord-bot-testing` see Discord’s native timeout on `/ask` while Holocron and CLI paths can succeed when the indexer and research venv are up. The failure mode points to missing or late interaction acknowledgement, not necessarily bad RAG answers.

---

## Requirements

- R1. `/ask` must call `deferReply` (or equivalent acknowledgement) within Discord’s initial interaction window before any slow work.
- R2. Guild/channel policy denials must still produce a visible embed via `editReply` after defer.
- R3. Stale interaction (`10062`) must not throw; logs must explain skipped work.
- R4. Regression tests cover defer success, ephemeral fallback, and stale-token paths without a live Discord gateway.
- R5. Holocron Playwright (`pnpm holocron:e2e`) and `pnpm verify:trask-cli` pass on golden queries after indexer seed.
- R6. Runbook documents always-on `trask-bot` process and channel ID verification for `TRASK_APPROVED_CHANNEL_IDS`.

---

## Scope Boundaries

- Rewriting the full RAG compose pipeline (landed in 2026-05-19-001 plan).
- Automated live Discord slash testing in CI (no bot token in GitHub Actions).
- PazaakWorld or Nakama gameplay surfaces.

### Deferred to Follow-Up Work

- Hosted Render/Fly always-on deploy manifest for `trask-bot`: separate infra PR if not already running in production.

---

## Key Technical Decisions

- **Early defer for `/ask`:** Acknowledge in `interactionCreate` before guild/channel gates so policy checks cannot miss the 3s SLA if the event loop is briefly busy.
- **Policy errors after defer:** Use `editReply` instead of `reply` when interaction is already deferred.
- **Verification split:** Unit tests for Discord handler; Playwright for Holocron; manual Discord smoke after starting `pnpm dev:trask` with valid token.

---

## Implementation Units

- U1. **Discord ask interaction module**

**Goal:** Extract and harden defer/reply helpers; early defer hook.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Create: `apps/trask-bot/src/discord-ask-interaction.ts`
- Modify: `apps/trask-bot/src/main.ts`
- Test: `apps/trask-bot/src/discord-ask-interaction.test.ts`

**Approach:**
- Move `ensureAskDeferred`, `safeReply`, stale detection into module.
- Export `acknowledgeAskInteraction` for use at top of `interactionCreate`.
- Refactor guild/channel denial paths to `editReply` when deferred.

**Test scenarios:**
- Happy path: mock interaction → `deferReply` called once.
- Edge case: already deferred → no second defer.
- Error path: `deferReply` throws 10062 → returns false, no throw.
- Error path: public defer fails, ephemeral defer succeeds.

**Verification:** Unit tests pass; manual `/ask` shows “thinking” immediately.

---

- U2. **Ops runbook and channel verify script**

**Goal:** Operators can confirm bot process and channel allowlist.

**Requirements:** R6

**Dependencies:** U1

**Files:**
- Create: `scripts/trask_discord_channel_verify.mjs`
- Modify: `docs/trask-ops.md`, `docs/knowledgebase/10-architecture-runtime/trask-discord-slash-contract.md`

**Test expectation:** none — documentation and optional CLI helper.

**Verification:** Script lists guild channels when `TRASK_DISCORD_BOT_TOKEN` is set.

---

- U3. **End-to-end research verification**

**Goal:** Prove shared backend used by Discord works.

**Requirements:** R5

**Dependencies:** U1

**Files:**
- Use existing: `scripts/trask_index_seed_for_qa.sh`, `apps/holocron-web/e2e/holocron-research.spec.ts`, `scripts/verify_trask_cli_qa.mjs`

**Verification:** `pnpm holocron:e2e` and `pnpm verify:trask-cli` green with indexer seeded.

---

## System-Wide Impact

- **Interaction graph:** Only `apps/trask-bot` Discord entry; Holocron HTTP unchanged.
- **Unchanged invariants:** Research wizard contract, indexer retrieve API, proactive handler registration order.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Production bot not running | Document always-on requirement; verify script for channel IDs |
| Wrong `TRASK_APPROVED_CHANNEL_IDS` | Channel verify script + clear `editReply` error after defer |

---

## Sources & References

- Origin: `docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md`
- `apps/trask-bot/src/main.ts` — current `/ask` handler
- `docs/knowledgebase/10-architecture-runtime/trask-discord-slash-contract.md`
