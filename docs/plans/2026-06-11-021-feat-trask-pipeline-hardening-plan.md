---
title: "feat: Trask pipeline hardening and validation"
status: active
date: 2026-06-11
origin: docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md
deepened: 2026-06-11
---

# feat: Trask pipeline hardening and validation

## Summary

Ship-blockers for the replacement-first Trask Q&A pipeline are landed (provider policy, Discord export targets, citation fail-closed, proactive supersession, doc coherence). This plan covers the **remaining hardening slice**: latency budget enforcement, indexing performance, verify-script parity, code simplification, and live validation gates before merge.

## Problem Frame

The pipeline meets product invariants on paper and in unit tests, but production-shaped gaps remain: hosted provider retries can exhaust the global research budget before Cloudflare or deterministic fallback run; Discord archive indexing is full-scan oriented; live verify scripts may omit Discord citation authorization context; and Holocron/Discord live gates have not been re-run on the post-fix stack.

## Requirements

| ID | Requirement |
|----|-------------|
| R-LAT | `TRASK_RESEARCH_BUDGET_MS` must cap **each provider attempt** and leave remainder for Cloudflare then extractive fallback (REQ-C). |
| R-IDX | Discord export indexing should skip unchanged windows where possible and batch embedding upserts for large archives. |
| R-VER | `pnpm verify:trask-discord` and import-smoke paths must pass destination guild/channel context so fail-closed Discord citations are exercised. |
| R-SIM | Proactive and indexer code should not duplicate audit/suppression or ID-set normalization patterns. |
| R-LIVE | Full offline gate plus live Holocron e2e and Discord verify after stack restart. |

Traceability: R-LAT/R-VER/R-LIVE align with origin REQ-C, R13, and R16.

## Key Technical Decisions

1. **Budget as a deadline, not a per-call timeout only** — thread a monotonic `budgetDeadlineMs` (or remaining-ms callback) from `ResearchWizardClient` into HF and Cloudflare compose attempts; each provider gets `min(perProviderCap, remainingBudget)`.
2. **Incremental Discord indexing (phase 1)** — compare `window_content_hash` metadata before re-embedding; skip upsert when hash unchanged. Full reconciliation/purge stays on target-level reconcile.
3. **Verify scripts own auth context** — Discord live/import-smoke callers pass `{ destinationGuildId, destinationChannelId, authorizedDiscordChannelIds }` matching bot config; no change to fail-closed gate semantics.
4. **Simplification in-place** — dedupe audit helpers and small Python/TS utilities without behavior change; no new abstractions beyond one helper per repeated pattern.

## Implementation Units

### U1. Research budget threading

**Goal:** Hosted providers respect remaining budget; Cloudflare and deterministic fallback still run when HF fails late in the window.

**Requirements:** R-LAT

**Dependencies:** none

**Files:** `packages/trask/src/research-wizard.ts`, `packages/trask/src/grounded-evidence.ts`, `packages/config/src/index.ts`, `packages/trask/src/research-wizard.test.ts`, `packages/trask/src/grounded-evidence.test.ts`

**Approach:** Introduce a budget tracker at research entry; decrement on each provider attempt; short-circuit to next tier when remaining ≤ 0. Log trace events with `remaining_budget_ms`.

**Test scenarios:**
- HF timeout with 5s remaining still attempts Cloudflare when configured.
- HF consumes full budget → deterministic extractive path runs without hanging.
- Budget env unset uses existing default (30000ms).

**Verification:** Unit tests pass; stderr trace shows provider order and remaining budget.

### U2. Discord indexing performance

**Goal:** Reduce redundant work on large DiscordChatExporter archives.

**Requirements:** R-IDX

**Dependencies:** U1 optional (independent)

**Files:** `infra/trask-indexer/trask_indexer/discord_index.py`, `infra/trask-indexer/trask_indexer/chroma_store.py`, `infra/trask-indexer/tests/test_discord_index_targets.py`

**Approach:** Before upsert, query existing chunk metadata for `(source_target, channel_id, first_message_id)` and skip when `window_content_hash` matches. Batch `upsert_chunks` calls where chroma_store already supports batching.

**Test scenarios:**
- Re-import unchanged export → chunk count stable, zero new embeddings (mock embedder).
- Edited message changes hash → window re-indexed.
- `channel_ids` allowlist still excludes non-listed channels.

**Verification:** Python tests pass; manual sync on sample export shows faster second run.

### U3. Verify-script citation auth parity

**Goal:** Live and import-smoke Discord gates exercise fail-closed citation auth.

**Requirements:** R-VER

**Dependencies:** none

**Files:** `scripts/verify_trask_discord_live.mjs`, `scripts/lib/trask_research_trace_assert.mjs`, `packages/trask/src/research-wizard.test.ts` (if shared fixtures)

**Approach:** Pass authorization context from env (`TRASK_APPROVED_CHANNEL_IDS`, guild id) into research calls the same way `apps/trask-bot` does for `/ask`.

**Test scenarios:**
- Import-smoke with Discord jump URL and **no** auth context → citation stripped, embed still passes contract or fails loudly per fixture.
- Live verify with auth context → jump links appear when indexed.

**Verification:** `pnpm trask:verify-import-smoke:ci` and `pnpm verify:trask-discord` (when token available).

### U4. Code simplification (completed slice)

**Goal:** Remove duplicated failure-audit and ID-set normalization without behavior change.

**Requirements:** R-SIM

**Dependencies:** none

**Files:** `apps/trask-bot/src/proactive-handler.ts`, `infra/trask-indexer/trask_indexer/discord_index.py`

**Approach:** `auditFailure` helper for proactive suppress paths; `_id_set()` for Discord channel filters.

**Test expectation:** none — refactor only; covered by existing tests.

**Verification:** `pnpm build`; targeted trask-bot/trask/indexer tests unchanged.

### U5. Live validation ladder

**Goal:** Confirm end-to-end behavior on restarted stack.

**Requirements:** R-LIVE

**Dependencies:** U1–U3 as applicable before claiming done

**Files:** none (execution)

**Approach:** `pnpm build` → `bash scripts/trask_live_stack.sh` → `pnpm trask:gate` → `pnpm holocron:e2e` → `pnpm verify:trask-discord` when token set.

**Test scenarios:** All five Holocron verification queries substantive with ≥2 https sources; Discord golden set passes embed contract.

**Verification:** Gate outputs documented in `docs/evidence/` if browser gate scripts run.

### U6. Discord hub ModSync design system (this pass)

**Goal:** Restyle static Discord bots hub surfaces with OpenKotOR ModSync tokens (K1/TSL/Light) and brokered Trask invite links.

**Requirements:** R-LIVE (surface parity)

**Files:** `packages/modsync-tokens/**`, `apps/hk86-web/**`, `apps/pazaak-world/src/components/DiscordBotsHub.tsx`, `apps/cardworld/src/components/DiscordBotsHub.tsx`, `infra/trask-worker/**`

**Verification:** `pnpm --filter hk86-web test:e2e`, agent-browser on dev hub, `pnpm trask:gate:ci`.

## Scope Boundaries

**In scope:** Budget threading, incremental indexing phase 1, verify auth context, simplification, live gates.

**Deferred for later:** Paginated purge across entire Chroma collection; reranker swap to `bge-reranker-v2-m3`; sync exit code when all export targets skip (P2 polish).

**Out of scope:** Replacing Chroma/Crawl4AI; OpenRouter-as-primary policy; full ModSync React component library port.

### Delta Update (2026-06-13, DCE flat adapter)

- **Landed:** `discord_index.py` ingests DCE flat `* [channel_id].json` (manifest layout still preferred when both exist); per-target `channels_indexed` + `degraded_reason` when enabled target indexes 0 chunks; sync/preflight scripts recognize flat layout; bridge runbook post-scrape tree + KotOR enablement checklist; `AGENTS.md` + `STRATEGY.md` two-repo track; pytest coverage for flat layout and degraded targets.
- **Partial:** KotOR_discord_msgs target still `enabled: false` (pilot sync against live `~/Documents/KotOR_discord_msgs` not run this pass); U5 live Holocron e2e + Discord verify; sync exit code on all-degraded targets still deferred (P2).
- **Next:** Enable KotOR pilot target after manual sync proves chunks > 0; run `bash scripts/trask_live_stack.sh` + `pnpm verify:trask-discord`; optional `--strict` on `trask_discord_sync_after_scrape.sh` to fail on degraded targets.

### Delta Update (2026-06-13)

- **Landed:** ModSync design showcase page at `apps/hk86-web/design.html` (themes triptych, typography, semantic swatches, hub components, spacing scale); hub ↔ design cross-links; `@openkotor/modsync-tokens/css/showcase.css`; hk86 Playwright covers design page + TSL theme toggle; prior U6 hub restyle + trask pipeline hardening diff retained on branch.
- **Partial:** U2 incremental Discord indexing; U5 full live Holocron e2e + Discord verify (stack restart deferred to post-merge CI/local); dependabot PR #101 open.
- **Next:** Commit + push → open PR `feat/discord-hub-modsync-design-trask-invite`; CI watch; merge dependabot #101 if green; post-merge run `bash scripts/trask_live_stack.sh` + `pnpm holocron:e2e`; configure Worker invite secrets (`TRASK_DISCORD_APP_ID`, `TRASK_INVITE_ALLOWED_GUILD_IDS`).

### Delta Update (2026-06-12)

- **Landed:** `@openkotor/modsync-tokens` package (colors/typography/spacing + hub-shell); hk86-web + pazaak/cardworld DiscordBotsHub restyled with K1/TSL/Light theme switcher; Trask brokered invite via Worker `/api/trask/invite`; trask pipeline hardening diff (budget threading, grounded evidence, worker invite policy); `pnpm trask:gate:ci` composite 215; hk86 Playwright smoke pass; agent-browser hub verification.
- **Partial:** U2 incremental Discord indexing; U5 full live Holocron e2e + Discord verify (stack not restarted this pass); dependabot PR #101 open.
- **Next:** Commit + push feature branch → PR; merge dependabot #101 if CI green; run `bash scripts/trask_live_stack.sh` + `pnpm holocron:e2e` + `pnpm verify:trask-discord` before merge claim; deploy trask-worker invite secrets (`TRASK_DISCORD_APP_ID`, `TRASK_INVITE_ALLOWED_GUILD_IDS`).

## Risks

- Budget threading regressions could shorten answers if caps are too aggressive — characterize with fixtures before live e2e.
- Hash-skip optimization must not skip tombstone/reconcile paths after message deletion.

## Sources

- Origin: `docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md`
- Prior implementation plan: `.cursor/plans/trask-qa-pipeline_3561ef66.plan.md` (units marked complete)
- Coherence + compound refresh: 2026-06-11 session
