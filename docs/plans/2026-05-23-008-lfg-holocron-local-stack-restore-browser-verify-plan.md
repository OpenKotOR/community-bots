---
title: "LFG restore Holocron :4010 after connection refused"
type: fix
status: completed
date: 2026-05-23
origin: user ERR_CONNECTION_REFUSED on http://127.0.0.1:4010
---

# LFG — Holocron local stack restore + browser verify

## Problem frame

Browser reports `ERR_CONNECTION_REFUSED` on `http://127.0.0.1:4010/?thread=…` because `trask_live_stack.sh` was stopped; no listener on :4010/:8787/:8790.

## Scope

**In:** Restart full Trask live stack; confirm `:4010` serves Holocron; browser-verify thread URL + at least one live research query with citations. Use Cursor browser MCP + targeted Playwright CLI (no `pnpm test`, no full `pnpm holocron:e2e`).

**Out:** Code changes unless review autofix requires; CI; public Pages deploy.

## Requirements

| R-ID | Requirement | Verification |
|------|-------------|--------------|
| R1 | Stack listening :8790, :8787, :4010 | `curl` health + `/` |
| R2 | User thread URL loads Holocron UI | Browser MCP navigate + snapshot |
| R3 | Submit question → substantive answer + https citations | Browser MCP full flow |
| R4 | Playwright can reach same origin | `playwright` open/snapshot smoke |

## Implementation units

### U1 — Restart stack

- Run `bash scripts/trask_live_stack.sh` (background)
- Wait for `Trask live stack ready`

### U2 — Browser MCP verification

- Navigate `http://127.0.0.1:4010/?thread=<fresh-uuid>`
- Submit one expert verification query; wait until Thinking clears; confirm Answer + Sources

### U3 — Playwright smoke (not full e2e suite)

- `pnpm exec playwright open` or minimal script against :4010 — confirm page title / Question input

## Risks

- Missing LLM keys → research completes failed/partial; document blocker
- Stack startup race → retry curl before browser

## Validation (2026-05-23)

| Check | Result |
|-------|--------|
| `curl :4010/:8787/:8790` | All up after `bash scripts/trask_live_stack.sh` |
| User thread URL | Browser MCP: Holocron loads at `?thread=aaaaaaaa-bbbb-…` |
| Live research | TSLPatcher/2DA query → grounded answer, 2 citations, 18-step trace |
| Playwright | `playwright screenshot` → `/tmp/holocron-smoke-4010.png` (1280×720) |
| agent-browser | Question input + HOLOCRON ARCHIVE visible on :4010 |

**Root cause confirmed:** `ERR_CONNECTION_REFUSED` was stopped stack, not bad thread UUID.
