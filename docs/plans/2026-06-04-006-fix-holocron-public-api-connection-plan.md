---
title: "fix(holocron): public API connection, logging, and CI health gates"
type: fix
status: completed
date: 2026-06-04
origin: user report — qa-webui 503 on trask-worker, stuck Dispatching, missing assets
---

# Holocron public API connection fix

## Problem

- [REPO] `TRASK_API_BASE` → `trask-worker.bocloud.workers.dev` proxies to `TRASK_RESEARCHWIZARD_BASE_URL` (`openkotor-holocron-trask-http.hf.space`).
- [UI] HF Space is **ERROR** → upstream returns **503**; Holocron stays on “Dispatching” with silent retries.
- [UI] No connection status panel; console-only errors.
- [UI] `/holocron/holocron-artifact.png` 404 on Pages (`BASE=/community-bots/qa-webui/`).
- [UI] `/_spark/loaded` 405 — Spark bundle still loaded when `ENABLE_SPARK=0`.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | Worker returns structured JSON on upstream failure (status, upstream URL, hint) |
| R2 | Holocron shows API health banner + research-step errors; fail after bounded retries |
| R3 | Static assets respect `import.meta.env.BASE_URL` |
| R4 | Stub Spark when not enabled at build time |
| R5 | CI: post-deploy worker smoke + gate Pages build on `TRASK_API_BASE` health |

## Out of scope

- Rebuilding HF Space runtime in this pass (workflow exists; ops must fix Space or change `TRASK_RESEARCHWIZARD_BASE_URL`).
