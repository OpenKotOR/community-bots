---
status: completed
branch: feat/holocron-topnav-ci-followup
date: 2026-06-11
---

# Plan: Holocron failure Playwright port isolation

## Problem

Local `pnpm holocron:e2e:playwright:failure` failed when `trask_live_stack` already bound **:4010** (`reuseExistingServer: false`).

## Solution

- Failure config defaults to **:4011** (`TRASK_HTTP_PORT` override).
- `trask_qa_surfaces.sh` no longer kills **:4010** before failure e2e.
- `pnpm trask:public-api:check` wraps `scripts/check_trask_public_api.sh`.
