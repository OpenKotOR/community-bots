---
status: active
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-06-03-001-feat-trask-playwright-holocron-discord-e2e-plan.md
date: 2026-06-04
---

# Plan: Trask Discord Playwright harness + Holocron citation e2e

## Problem (pre-fix)

Holocron has six Playwright tests (`holocron-research.spec.ts`), but Discord `/ask` contract validation is **Node-only** (`verify_trask_discord_live.mjs`). Agents and CI lack a **browser-level** Discord embed gate that uses Playwright while avoiding discord.com UI fragility and guild tokens.

Holocron e2e does not assert **source card permalink labels** (`README.md#Ln`) after the citation presentation slice (PR #98).

## Inferred Intent

- **Direct ask:** Continue Trask Q&A quality with Playwright for Holocron and Discord surfaces; browser-verify both.
- **Adjacent impact:** CI ladder parity, import-smoke ↔ Playwright alignment, citation label regressions caught in e2e.
- **Cohesive scope:** Offline Discord Playwright harness (golden compose, no LLM); Holocron Playwright assertions for citation hygiene; root scripts + CI step; local full ladder run.
- **Risks if partial:** Discord regressions only caught by slow live verify; Holocron UI label bugs slip past Playwright.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | Playwright spec exercises all five `DISCORD_IMPORT_SMOKE_SPECS` embed descriptions via static harness (no discord.com, no LLM) |
| R2 | Harness assertions mirror `verify_trask_discord_live.mjs` import-smoke contract (lines, inline links, no Sources block, expectPattern) |
| R3 | Holocron Playwright asserts Sources panel labels avoid `githubusercontent.com` path noise |
| R4 | Root `package.json` exposes `trask:e2e:discord:playwright` and `trask:e2e:playwright` (Holocron + Discord) |
| R5 | CI runs Discord Playwright after `trask:gate:ci` (fast, offline) |
| R6 | Local: stack up → `pnpm trask:e2e:playwright` or Holocron-only with `HOLOCRON_REUSE_SERVER=1` |

## Scope boundaries

- **In:** Playwright harness server, specs, Holocron assertion tweak, package scripts, CI step.
- **Out:** Playwright against discord.com in CI; live Discord token in GitHub Actions UI tests.

## Implementation units

### U1 — Discord ask display audit module

- **Files:** `scripts/lib/discord_ask_display_audit.mjs` (extract from verify script)
- **Tests:** existing import-smoke via `pnpm verify:trask-discord:ci`

### U2 — Discord Playwright harness

- **Files:** `scripts/discord-ask-e2e-webserver.mjs`, `e2e/trask-discord-ask.spec.mjs`, `playwright.trask-discord.config.mjs`
- **Verification:** `pnpm trask:e2e:discord:playwright` — 5 tests pass in <30s

### U3 — Holocron citation Playwright assertions

- **Files:** `apps/holocron-web/e2e/holocron-research.spec.ts`
- **Verification:** sources panel + answer body hygiene checks per query

### U4 — Scripts + CI

- **Files:** `package.json`, `.github/workflows/ci.yml`
- **Verification:** CI job step green

### U5 — Local verification

```bash
pnpm build && pnpm trask:gate:ci
pnpm trask:e2e:discord:playwright
bash scripts/trask_live_stack.sh
HOLOCRON_REUSE_SERVER=1 pnpm holocron:e2e:playwright
```

## Deferred

- Optional headed Discord web UI proof (`discord_fetch_trask_token.mjs` profile) — operator-only.
