---
title: "feat: Trask VPS indexer systemd units and stack health verifier"
type: feat
status: completed
date: 2026-05-24
merged: fbc6533
pr: https://github.com/OpenKotOR/community-bots/pull/10
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
---

# Trask VPS Indexer Systemd + Stack Health Verifier

## Summary

Complete in-repo VPS operator rollout artifacts for the **indexer side** of the indexed stack: systemd unit templates for `trask-indexer serve` and `run-queue-worker`, plus a health script operators run after deploy (mirrors runbook curl checks + `discord_sync_stale`).

---

## Problem Frame

PR #9 landed bot deploy manifest (`infra/trask-bot-stack/`) but VPS operators still lack systemd templates for Chroma indexer and queue worker, and no single script validates `:8790` / `:8787` / optional `:4010` after rollout.

---

## Requirements

- R1. `scripts/trask_indexed_stack_health.sh` exits 0 when indexer (+ optional worker/HTTP) health endpoints respond; warns on `discord_sync_stale=true`
- R2. `infra/trask-indexer/systemd/trask-indexer.service.example` and `trask-indexer-queue-worker.service.example`
- R3. Runbook + `infra/trask-indexer/README.md` reference systemd and health script
- R4. Parent plan delta notes VPS indexer artifacts landed

---

## Scope Boundaries

- Cloudflare Worker production deploy (Wrangler on VPS)
- Actual VPS execution in this session

---

## Implementation Units

### U1. Health verifier script

**Files:** Create `scripts/trask_indexed_stack_health.sh`

**Verification:** dry-run against local stack when ports up

### U2. Systemd examples + docs

**Files:**
- Create `infra/trask-indexer/systemd/*.service.example`
- Modify runbook, indexer README, parent plan delta

---
