---
title: "ci: optional LLM keys for Holocron e2e compose"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
---

# Optional LLM Keys in CI for Holocron E2E

## Summary

Wire repository secrets into the main CI Holocron e2e step so compose uses OpenRouter/OpenAI when configured, while keeping the job green without secrets (heuristic/citation-only path). Closes the last parent crawl4ai ops-closure item on PR #9.

---

## Problem Frame

`pnpm holocron:e2e` in `.github/workflows/ci.yml` passes indexer env but not `OPENROUTER_API_KEY` / `OPENAI_API_KEY`. `scripts/holocron-e2e-live-server.sh` warns when no LLM is configured. HF deploy workflow already syncs optional LLM secrets; main CI does not.

---

## Requirements

- R1. Holocron e2e step receives optional `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `TRASK_LLM_PROFILE=free`, OpenRouter headers
- R2. Pre-e2e step logs whether LLM secrets are present (no secret values)
- R3. Runbook/docs note CI secret names for richer compose
- R4. Parent crawl4ai plan delta marks item complete

---

## Scope Boundaries

- Requiring secrets (job must pass without them)
- LiteLLM proxy in CI
- Changing e2e pass criteria

---

## Implementation Units

### U1. CI workflow env + notice step

**Files:** Modify `.github/workflows/ci.yml`

### U2. Docs + parent plan delta

**Files:**
- Modify `docs/knowledgebase/50-execution/trask-indexed-stack-runbook.md`
- Modify `docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md`

---

## Test Scenarios

- YAML valid; env block mirrors `trask-http-public.yml` secret names
- Notice step prints configured vs heuristic path without echoing keys

---
