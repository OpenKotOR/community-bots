---
title: "feat(trask): green CI — HF embedding pre-warm"
type: feat
status: in_progress
date: 2026-06-03
origin: user /lfg continue + PR #94 CI Failures Unresolved (HF 429)
---

# CI embedding pre-warm (LFG pass 3)

## Problem Frame

Build & Test failed because Actions cached `~/.cache/fastembed` while FastEmbed writes to `/tmp/fastembed_cache` (or `FASTEMBED_CACHE_PATH`). Cache never hit → duplicate `snapshot_download` + 429. Fix: set `FASTEMBED_CACHE_PATH=${{ github.workspace }}/.cache/fastembed`, cache that path (key v3), single `ci_warm_trask_embed.sh` probe with backoff.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | `FASTEMBED_CACHE_PATH` aligned with `actions/cache` path `.cache/fastembed` |
| R2 | `scripts/ci_warm_trask_embed.sh` — embed probe only (no extra hub repos); backoff on 429 |
| R2b | Cache key `fastembed-bge-small-*-v3` |
| R3 | PR #94 Build & Test green through Holocron e2e + final gate |

## Out of scope

Discord.com Playwright; weakening e2e assertions.
