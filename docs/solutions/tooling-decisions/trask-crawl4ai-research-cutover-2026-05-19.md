---
title: "Trask live research cutover to Crawl4AI indexer"
date: 2026-05-19
category: tooling-decisions
problem_type: tooling_decision
component: background_job
module: trask
tags:
  - "trask"
  - "holocron"
  - "crawl4ai"
  - "indexer"
applies_when: "Implementing or debugging Trask/Holocron live web research, Docker HF deploy, or research env vars"
---

## Context

Holocron and Discord `/ask` previously depended on a vendored Python research subprocess that was fragile to bootstrap (heavy deps, submodule drift, failed venv installs). The product mandate was to own retrieval: approved-host crawl → chunk → embed → index → cite.

## Guidance

- **Node bridge:** `packages/trask/src/trask-research-subprocess.ts` spawns `scripts/trask_web_research.py` (not the removed vendor tree).
- **Python runner order:** `POST {TRASK_INDEXER_BASE_URL}/retrieve` → local Chroma (`data/trask-indexer`) → DuckDuckGo (`ddgs`) on allowlisted hosts.
- **Config:** `loadResearchWizardRuntimeConfig` (`packages/config/src/index.ts`) exposes `indexerBaseUrl`, `researchScriptPath`, `pythonExecutable`, `timeoutMs`. Prefer `.venv-trask-research` via `bash scripts/bootstrap_trask_research.sh`.
- **Product policy (repo data):** golden queries, surface profiles, linguistics, and retrieval defaults live under `data/trask/` (loaded by `@openkotor/trask-config`). After edits, run `pnpm trask:config-drift` so code and JSON stay aligned.
- **Env:** `TRASK_WEB_RESEARCH_PYTHON`, `TRASK_INDEXER_BASE_URL` (default `http://127.0.0.1:8790`), `TRASK_RESEARCH_TIMEOUT_MS` (aliases `TRASK_RESEARCHWIZARD_TIMEOUT_MS`, default **900000**).
- **HF Docker:** `infra/trask-http-public/Dockerfile` bootstraps `.venv-trask-research` and ships `infra/trask-indexer` + `scripts/trask_web_research.py`.
- **Discord `/ask` display:** same research stack; UX gates are `pnpm verify:trask-discord` and `packages/trask/src/discord-reply-format.ts` (single on-topic line, inline `[n](url)` citations — no separate Sources block).

## Why This Matters

Agents and CI were blocked on a submodule that users explicitly retired. A single owned script plus the existing indexer spike keeps Holocron contracts stable while eliminating the old bootstrap path.

## When to Apply

- Adding research features, env vars, or deploy docs for Trask/Holocron.
- Debugging empty reports, timeouts, or missing citations in live Q&A (Holocron: `pnpm holocron:e2e` + `pnpm verify:trask-cli`; Discord: `pnpm verify:trask-discord`).

## Examples

**Before (removed):** vendored Python research subprocess + dedicated legacy venv at repo root.

**After:**

```typescript
import { runTraskWebResearch } from "./trask-research-subprocess.js";

const raw = await runTraskWebResearch(config, {
  query,
  query_domains: allowedDomains,
  allowed_url_prefixes: approvedSources.map((s) => s.homeUrl),
});
```

```bash
bash scripts/bootstrap_trask_research.sh
export TRASK_WEB_RESEARCH_PYTHON=.venv-trask-research/bin/python
echo '{"query":"TSLPatcher","query_domains":["deadlystream.com"]}' \
  | .venv-trask-research/bin/python scripts/trask_web_research.py
```
