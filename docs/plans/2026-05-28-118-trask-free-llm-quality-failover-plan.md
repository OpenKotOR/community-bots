---
title: "feat(trask): quality-ordered free LLM failover + Holocron/Discord verify"
type: feat
status: completed
date: 2026-05-28
origin: user request — free models default, quality-first failover, browser proof
---

# Free LLM quality failover + surface verification

## Requirements

- **R1.** `TRASK_LLM_PROFILE=free` remains default; primary `openrouter/free`, fallbacks are **curated quality-first** OpenRouter `:free` models, then vendor list, then `openrouter/auto`.
- **R2.** Rewrite compose tries up to 8 models (primary + fallbacks) before deterministic fallback.
- **R3.** `trask_live_stack.sh` exports `TRASK_LLM_PROFILE=free` for local Holocron/Discord parity.
- **R4.** Browser: all five expert Holocron queries on :4010 — substantive answers, ≥2 https citations, `research_done` when grounded.
- **R5.** `pnpm verify:trask-discord` (live) when token present — expert queries pass contract.

## Files

- Modify: `packages/config/src/index.ts`, `packages/config/src/index.test.ts`
- Modify: `packages/trask/src/research-wizard.ts` (MAX_REWRITE_ATTEMPTS)
- Modify: `scripts/trask_live_stack.sh`, `docs/trask-research-backends.md`
- Verify: `apps/holocron-web/e2e` (browser MCP manual gate)

## Verification

```bash
pnpm build && node --test packages/config/dist/index.test.js
bash scripts/trask_live_stack.sh  # background
# browser: five expert queries on http://127.0.0.1:4010
pnpm verify:trask-discord
```
