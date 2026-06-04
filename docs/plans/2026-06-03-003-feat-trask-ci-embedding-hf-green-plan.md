---
title: "feat(trask): green CI — HF embedding pre-warm"
type: feat
status: in_progress
date: 2026-06-03
origin: user /lfg continue + PR #94 CI Failures Unresolved (HF 429)
---

# CI embedding pre-warm (LFG pass 3)

## Problem Frame

Build & Test fails before Holocron Playwright or import-smoke because **Pre-warm Trask embedding model** hammers HuggingFace with repeated fastembed init retries (429). Local gates are green; branch needs one reliable hub download + cache.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | Single authenticated `snapshot_download` for fastembed ONNX repos, then one embed probe |
| R2 | Bump Actions cache key so empty partial caches are not reused |
| R3 | PR #94 Build & Test green through Holocron e2e + final gate |

## Out of scope

Discord.com Playwright; weakening e2e assertions.
