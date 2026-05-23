---
title: "LFG PR #7 merge-ready after Holocron compose fix"
type: chore
status: completed

## Validation (2026-05-23)

| Check | Result |
|-------|--------|
| `gh pr checks 7` | All pass (Build & Test, docker-builds, CodeQL, analyze, verify-bundle) |
| Stack | Restarted via `trask_live_stack.sh` (indexer had died → 0 passages) |
| Browser MCP | Grounded answer, 2 clean paragraphs, citations 1+2, no `- #` leak |
| HEAD | `a6136b0` compose fix on branch |
date: 2026-05-23
origin: docs/plans/2026-05-23-009-fix-holocron-grounded-answer-compose-plan.md
---

# LFG — PR #7 merge-ready gate

## Problem frame

Compose fix landed in `a6136b0`. PR #7 should be merge-ready: CI green, browser confirms clean Answer text on :4010, no uncommitted code.

## Requirements

| R-ID | Requirement | Verification |
|------|-------------|--------------|
| R1 | CI checks pass on latest push | `gh pr checks 7` |
| R2 | Holocron :4010 serves + research works | Browser MCP query |
| R3 | Compose fix present on branch | `git log -1`, API answer has no `- #` |
| R4 | Branch pushed, PR open | `gh pr view 7` |

## Implementation units

### U1 — CI + stack verify

- Poll `gh pr checks 7` until Build & Test + docker-builds pass
- Ensure `trask_live_stack` or trask-http on :4010

### U2 — Browser smoke

- One expert query; Answer region: 2 paragraphs, citations, no markdown leak

### U3 — Ship hygiene

- Commit plan; push if needed; PR already open (#7)
