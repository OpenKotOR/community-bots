---
title: "feat: Discord sync stale flag on indexer /health"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
---

# Discord Sync Stale Health Signal

## Summary

Expose `discord_sync_stale` on indexer `GET /health` when `last_discord_sync` is older than a configurable threshold so operators can monitor production Discord→Chroma freshness.

---

## Problem Frame

Parent crawl4ai plan lists **stale-sync monitoring** as remaining ops work. `/health` already returns `last_discord_sync` but operators must compute staleness themselves.

---

## Requirements

- R1. `/health` includes `discord_sync_stale: bool` when status file exists
- R2. Threshold via `TRASK_DISCORD_SYNC_STALE_HOURS` (default 48)
- R3. Unit tests for fresh/stale/missing status file
- R4. Runbook documents the fields

---

## Scope Boundaries

- PagerDuty/alertmanager wiring
- Bot-side monitoring (indexer only)

---

## Implementation Units

- U1. `build_health_payload()` in `retrieve_api.py` + tests
- U2. Runbook + env map doc lines

**Verification:** `pnpm trask:indexer:test`

---
