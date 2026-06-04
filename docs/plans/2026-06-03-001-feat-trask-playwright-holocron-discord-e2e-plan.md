---
title: "feat(trask): Holocron Playwright + Discord verify CI wiring"
type: feat
status: completed
date: 2026-06-03
origin: user /lfg request — Trask Q&A Discord + Holocron archive, Playwright + browser
deepened: 2026-06-03
---

# Holocron Playwright + Discord live/import smoke (LFG continuation)

## Problem Frame

Plan 118 shipped free-LLM failover and resurrected `holocron-research.spec.ts` / `verify_trask_cli_qa.mjs`, but **source–docs–CI drift** remains: `AGENTS.md` and `validation-ladder.md` still claim deleted specs and 0 Playwright tests; `trask:verify-import-smoke:ci` and `verify:trask-*:ci` are documented everywhere but **missing from `package.json`**; `.github/workflows/ci.yml` stops after `trask:gate:ci` and never runs import-smoke or Holocron Playwright despite ladder claims.

Discord `/ask` has no Playwright-against-discord.com CI gate (by design — secrets + UI fragility). The **automated Discord E2E** is `scripts/verify_trask_discord_live.mjs` (wizard + `formatDiscordAskDisplay`, same stack as the bot). Holocron uses **Playwright** against `:4010` with five expert queries from `verification-queries.json`.

## Inferred Intent

- **Direct ask:** Continue Trask Q&A quality with Playwright for Holocron and rigorous Discord verification; use browser MCP when available.
- **Adjacent impact:** CI ladder parity, `package.json` scripts, AGENTS/validation-ladder/trask-research-backends accuracy, evidence refresh.
- **Cohesive scope:** Wire documented scripts; add CI steps (import-smoke always; Holocron Playwright when stack healthy); run full local ladder (build → stack → gate → holocron:e2e → verify:trask-discord → browser MCP 5/5); fix stale agent guidance.
- **Risks if partial:** Agents skip Holocron/Discord gates believing specs are deleted; CI green without browser path coverage.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | Root `package.json` exposes `verify:trask-cli:ci`, `verify:trask-discord:ci`, `trask:verify-import-smoke:ci` matching CONTRIBUTING / ladder |
| R2 | `ci.yml` runs `trask:verify-import-smoke:ci` after indexer+Worker bootstrap (`HOLOCRON_E2E_SKIP_STACK_BOOTSTRAP=1`) |
| R3 | `ci.yml` runs `pnpm holocron:e2e:playwright` with Playwright Chromium install; `TRASK_SKIP_BUILD=1`; stack already up |
| R4 | `AGENTS.md` + `validation-ladder.md` reflect restored Holocron spec (6 tests) and live verify scripts |
| R5 | Local: `pnpm build`, `bash scripts/trask_live_stack.sh`, `pnpm trask:gate`, `pnpm holocron:e2e:playwright`, `pnpm verify:trask-discord` all pass |
| R6 | Browser MCP: five fresh-thread expert queries on `http://127.0.0.1:4010` when MCP available |

## Scope Boundaries

**In:** package scripts, CI steps, doc drift fixes, evidence timestamp refresh if verify re-run.

**Out:** Playwright automation against discord.com in CI; scheduler bearer auth; public Pages qa-webui full pass.

### Deferred to Follow-Up Work

- Optional headed Playwright proof script for Discord web UI (`docs/trask.md` slash-option flow) — operator-only, not CI.

## Key Technical Decisions

1. **Discord “e2e” = live verify script**, not discord.com Playwright — mirrors bot pipeline, no guild token in CI for UI (import-smoke covers embed contract).
2. **Holocron URL HEAD checks** stay disabled in Playwright webServer via `TRASK_SKIP_CITATION_URL_VERIFY=1` (`holocron-e2e-webserver.mjs`); live Discord verify keeps HEAD unless `--skip-url-check`.
3. **CI Holocron Playwright** uses existing stack from prior job steps; `HOLOCRON_E2E_SKIP_STACK_BOOTSTRAP=1` avoids duplicate bootstrap race.

## Implementation Units

### U1. Restore package.json CI verify aliases

**Goal:** Documented scripts exist and are runnable.

**Files:** `package.json`

**Test scenarios:**
- `pnpm trask:verify-import-smoke:ci` exits 0 with indexer+Worker healthy
- `pnpm verify:trask-discord:ci` and `pnpm verify:trask-cli:ci` exit 0 individually

### U2. CI workflow — import-smoke + Holocron Playwright

**Goal:** GitHub Actions matches validation ladder.

**Files:** `.github/workflows/ci.yml`

**Test scenarios:**
- CI job steps run after stack bootstrap without starting a second indexer
- Playwright install step precedes `holocron:e2e:playwright`

### U3. Agent / KB doc drift cleanup

**Goal:** Stop instructing agents that Holocron e2e and CLI verify are missing.

**Files:** `AGENTS.md`, `docs/knowledgebase/50-execution/validation-ladder.md` (minimal edits)

### U4. Full local verification + browser MCP

**Goal:** Prove runtime parity after wiring.

**Verification:**
```bash
pnpm build
bash scripts/trask_live_stack.sh
pnpm trask:gate:ci
pnpm trask:verify-import-smoke:ci
HOLOCRON_REUSE_SERVER=1 pnpm holocron:e2e:playwright
pnpm verify:trask-discord
```
Plus five browser MCP queries per AGENTS.

## Risks

- Holocron Playwright in CI may fail without `OPENROUTER_API_KEY` — monitor first run; gate compose may degrade honestly if no key (still better than silent omission).
- Serial 6-test Holocron suite is slow (~20+ min) — acceptable for main CI; retries=1 already set.

## Sources

- `docs/plans/2026-05-28-118-trask-free-llm-quality-failover-plan.md`
- `docs/knowledgebase/50-execution/validation-ladder.md`
- `apps/holocron-web/e2e/holocron-research.spec.ts`
- `scripts/verify_trask_discord_live.mjs`
