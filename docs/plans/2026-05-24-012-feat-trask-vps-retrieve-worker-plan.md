---
title: "feat: VPS co-located Trask retrieve Worker (wrangler + systemd)"
type: feat
status: completed
date: 2026-05-24
merged: 30700ce
pr: https://github.com/OpenKotOR/community-bots/pull/11
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
---

# VPS Co-Located Retrieve Worker

## Summary

Add operator artifacts to run the retrieve Worker on a VPS beside Chroma (wrangler dev proxy on `:8787`), matching local `trask_live_stack.sh` production parity when Cloudflare edge deploy is not used.

---

## Problem Frame

Parent plan lists **production retrieve Worker on VPS** as next work. Cloudflare `wrangler deploy` is documented but co-located VPS path (systemd + start script) is not — operators must reverse-engineer `trask_live_stack.sh`.

---

## Requirements

- R1. `scripts/trask_retrieve_worker_start.sh` starts wrangler on configurable port with `TRASK_INDEXER_BASE_URL`
- R2. `infra/trask-retrieve-worker/systemd/trask-retrieve-worker.service.example` (After=trask-indexer.service)
- R3. Runbook + retrieve-worker README VPS section; note CF deploy as alternative
- R4. `pnpm trask:stack:health` npm script alias
- R5. Parent plan delta updated

---

## Scope Boundaries

- Vectorize migration
- Cloudflare account provisioning automation

---

## Implementation Units

### U1. Start script + systemd + package.json

**Files:** script, systemd example, `package.json`

### U2. Docs + parent plan

**Files:** runbook, retrieve-worker README, parent plan delta

---
