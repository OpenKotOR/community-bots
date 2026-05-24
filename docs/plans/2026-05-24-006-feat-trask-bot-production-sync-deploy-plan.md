---
title: "feat: Trask bot production deploy manifest with Discord sync interval"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
---

# Trask Bot Production Deploy Manifest (Discord Sync)

## Summary

Land operator-facing production deploy artifacts so VPS hosts enable continuous Discord→Chroma sync via `TRASK_DISCORD_SYNC_INTERVAL_MS` without hunting scattered docs. Closes the parent plan “Partial: Discord sync off unless interval set in production deploy.”

---

## Problem Frame

Discord index sync is implemented in `apps/trask-bot/src/discord-index-sync.ts` but defaults to **off** (`TRASK_DISCORD_SYNC_INTERVAL_MS=0`). Production operators lack a single manifest (env template + systemd example) wiring the recommended 30–60 min interval and `TRASK_INDEXER_BASE_URL`.

---

## Requirements

- R1. `infra/trask-bot-stack/.env.production.example` documents production vars including `TRASK_DISCORD_SYNC_INTERVAL_MS=1800000` (30 min)
- R2. `infra/trask-bot-stack/trask-bot.service.example` systemd unit referencing repo `scripts/trask_bot_start.sh`
- R3. `infra/trask-bot-stack/README.md` operator steps (indexer URL, sync interval, health stale monitoring)
- R4. `apps/trask-bot/.env.example` adds `TRASK_DISCORD_SYNC_INTERVAL_MS`, `TRASK_INDEXER_BASE_URL`, `TRASK_WEB_RESEARCH_PYTHON`
- R5. Parent crawl4ai plan delta marks Discord sync deploy manifest landed

---

## Scope Boundaries

- Docker image changes to bundle Python sync script (VPS uses host checkout + venv)
- Render/Fly hosted deploy automation
- Enabling sync in CI secrets

---

## Key Decisions

- **30 min default** (`1800000` ms) — middle of documented 15–60 min range; operators can tune.
- **Host-native deploy** — matches existing `scripts/trask_bot_start.sh` and indexer VPS pattern; no new container stack in this slice.

---

## Implementation Units

### U1. Production env template + systemd example

**Files:**
- Create: `infra/trask-bot-stack/.env.production.example`
- Create: `infra/trask-bot-stack/trask-bot.service.example`
- Create: `infra/trask-bot-stack/README.md`

**Verification:** grep confirms interval > 0 in example; README links runbook stale health fields

### U2. Bot `.env.example` + parent plan delta

**Files:**
- Modify: `apps/trask-bot/.env.example`
- Modify: `docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md`

**Verification:** `pnpm trask:config-drift` (if applicable) or manual review

---

## Test Scenarios

- Operator copies `.env.production.example` → repo `.env`, sets token, starts bot; `discord-index-sync` logs on interval (manual / existing bot tests unchanged)
- systemd example paths are repo-relative and documented as templates

---
