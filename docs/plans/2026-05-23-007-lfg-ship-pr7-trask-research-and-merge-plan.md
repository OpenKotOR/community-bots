---
title: "LFG ship PR #7 — Trask research quality bar"
type: feat
status: completed
date: 2026-05-23
origin: docs/plans/2026-05-19-005-feat-trask-research-agent-2026-standards-plan.md
---

# LFG ship PR #7 — Trask research quality bar

## Problem frame

PR [#7](https://github.com/OpenKotOR/community-bots/pull/7) on `feat/trask-crawl4ai-rag` implements the Crawl4AI RAG cutover and 2026 research quality bar (plan 005). CI is green; OpenRouter-only `/api/trask/ask` validated locally. This LFG slice ships the branch: final review, Holocron gate, PR hygiene, merge readiness.

## Scope

**In:** Code review autofix, Holocron e2e (or documented partial if stack unavailable), PR description update, working tree clean, merge-ready confirmation.

**Out:** Vectorize migration, VPS crawl, public Holocron deploy verification (post-merge optional).

## Requirements trace

| R-ID | Requirement | Verification |
|------|-------------|--------------|
| R1 | All PR checks green | `gh pr checks 7` |
| R2 | OpenRouter free-default LLM path works | Live `/api/trask/ask` grounded (validated 2026-05-23) |
| R3 | Holocron research e2e | `pnpm holocron:e2e` or browser MCP five queries |
| R4 | No CodeQL regressions | CodeQL merge check pass |
| R5 | PR documents LLM proxy + Worker path | PR body + `docs/trask-research-backends.md` |

## Implementation units

### U1 — Code review autofix

- **Files:** any touched by review
- **Verification:** `ce-code-review mode:autofix plan:docs/plans/2026-05-23-007-lfg-ship-pr7-trask-research-and-merge-plan.md`; commit `fix(review):` if changes

### U2 — Holocron validation gate

- **Files:** none (runtime)
- **Approach:** Restart `bash scripts/trask_live_stack.sh` if needed; run `HOLOCRON_REUSE_SERVER=1 pnpm holocron:e2e` when stack + keys available
- **Verification:** five canonical queries pass or explicit partial with blocker

### U3 — PR ship hygiene

- **Files:** PR body via `gh pr edit`; residual findings section if any
- **Verification:** `gh pr view 7` shows current stack, LLM env, test evidence

## Dependencies

U1 → U2 (optional parallel if report-only) → U3

## Risks

- Holocron e2e needs indexer seed + LLM keys + long runtime (~15–30 min)
- Browser MCP may be unavailable — Playwright alone satisfies AGENTS.md minimum when MCP unavailable

## LFG validation (2026-05-23)

| Gate | Result |
|------|--------|
| `gh pr checks 7` | All pass (Build & Test, CodeQL, docker-builds, analyze, verify-bundle) |
| `pnpm test` | 545/545 pass |
| `pnpm trask:faithfulness-eval` | 5/5 fixtures pass |
| `bash scripts/trask_live_stack.sh` | Indexer :8790, Worker :8787, Holocron :4010 healthy |
| `pnpm holocron:e2e` | **Blocked** — no `OPENROUTER_API_KEY` / LLM proxy in this environment |
