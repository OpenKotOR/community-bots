---
title: "Trask live research cutover to Crawl4AI indexer"
date: 2026-05-19
last_refreshed: 2026-06-11
category: tooling-decisions
problem_type: tooling_decision
component: background_job
module: trask
tags:
  - "trask"
  - "holocron"
  - "crawl4ai"
  - "indexer"
  - "huggingface"
  - "cloudflare"
  - "llm_fallbacks"
applies_when: "Implementing or debugging Trask/Holocron live web research, Docker HF deploy, or research env vars"
---

## Context

Holocron and Discord `/ask` previously depended on a vendored Python research subprocess that was fragile to bootstrap (heavy deps, submodule drift, failed venv installs). The product mandate is to own retrieval: approved-host crawl → chunk → embed → index → cite → **grounded assistant compose** (not open-web agent loops).

Product policy authority: `docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md`.

## Guidance

- **Node bridge:** `packages/trask/src/trask-research-subprocess.ts` spawns `scripts/trask_web_research.py` (not the removed vendor tree). Holocron/Discord compose via `ResearchWizardClient` (`packages/trask/src/research-wizard.ts`) with `TRASK_RESEARCH_COMPOSE_MODE=grounded` (default in `scripts/trask_live_stack.sh`).
- **Retrieve URL defaults:** `@openkotor/config` and `trask_live_stack.sh` set `TRASK_INDEXER_BASE_URL=http://127.0.0.1:8787` (Cloudflare retrieve **Worker**). Python script fallback default is `8790` (raw `trask-indexer serve`). Local stack: indexer :8790 → Worker :8787 → HTTP :4010.
- **Python gather order** (`scripts/trask_web_research.py`): `POST {TRASK_INDEXER_BASE_URL}/retrieve` → optional local Chroma → **bounded live Crawl4AI recovery** when `TRASK_WEB_RESEARCH_LIVE_CRAWL=1` and retrieve is weak → DuckDuckGo only when `TRASK_WEB_RESEARCH_DDG_FALLBACK=1` (default **off** in live stack).
- **Compose LLM (replacement-first):** `@openkotor/config` `loadSharedAiConfig` — **Hugging Face first** (`HF_TOKEN` / `HUGGINGFACE_TOKEN`), **Cloudflare second** (`TRASK_CLOUDFLARE_AI_BASE_URL` + token), then deterministic extractive fallback when hosted providers fail or budget is exhausted. Legacy OpenRouter/OpenAI keys remain optional paid paths via `TRASK_LLM_PROFILE=paid`. Ops proxy (optional): `bash scripts/trask_litellm_proxy.sh` with `vendor/llm_fallbacks/configs/litellm_config_free.yaml`.
- **Discord corpus:** DiscordChatExporter archives indexed via `data/trask/discord-export-targets.json` (`TRASK_DISCORD_EXPORT_TARGETS_CONFIG`); `channel_ids` on a target is an **allowlist** when non-empty. Citation authorization on the `discord` surface is fail-closed without destination context (`packages/trask/src/research-wizard.ts`).
- **Sufficiency gate (R6):** `passagesSupportGroundedCompose` gates LLM compose; `TRASK_QA_GROUNDING=1` enables 1-URL QA seed escape only.
- **Config:** `loadResearchWizardRuntimeConfig` (`packages/config/src/index.ts`) exposes `indexerBaseUrl`, `researchScriptPath`, `pythonExecutable`, `timeoutMs`. Prefer `.venv-trask-research` via `bash scripts/bootstrap_trask_research.sh`.
- **Product policy (repo data):** golden queries, surface profiles, linguistics, and retrieval defaults live under `data/trask/` (loaded by `@openkotor/trask-config`). After edits, run `pnpm trask:config-drift`.
- **Env:** `TRASK_WEB_RESEARCH_PYTHON`, `TRASK_INDEXER_BASE_URL`, `TRASK_WEB_RESEARCH_DDG_FALLBACK=0`, `TRASK_WEB_RESEARCH_LIVE_CRAWL=0` (recovery-only when `1`), `TRASK_RESEARCH_BUDGET_MS=30000`, `HF_TOKEN`, optional Cloudflare AI vars, `TRASK_DISCORD_EXPORT_TARGETS_CONFIG` (default `data/trask/discord-export-targets.json`), `TRASK_RESEARCH_TIMEOUT_MS` (aliases `TRASK_RESEARCHWIZARD_TIMEOUT_MS`, default **900000** parent ceiling).
- **HF Docker:** `infra/trask-http-public/Dockerfile` bootstraps research + indexer venvs, seeds QA Chroma at build, and **`docker-entrypoint.sh`** supervises `trask-indexer serve` (:8790) then `trask-http-server`. No Cloudflare Worker in-container — `TRASK_INDEXER_BASE_URL` hits raw indexer HTTP.
- **Discord `/ask` display:** same research stack; UX gates are `pnpm verify:trask-discord` and `packages/trask/src/discord-reply-format.ts` (single on-topic line, inline `[n](url)` citations — no separate Sources block).

## Why This Matters

Agents and CI were blocked on a submodule that users explicitly retired. A single owned script plus the indexer/Worker stack keeps Holocron contracts stable while eliminating the old bootstrap path.

## When to Apply

- Adding research features, env vars, or deploy docs for Trask/Holocron.
- Debugging empty reports, timeouts, or missing citations in live Q&A.

## Verification

- **CLI smoke:** `pnpm verify:trask-cli` (after `bash scripts/trask_live_stack.sh`).
- **Holocron browser e2e:** `pnpm holocron:e2e` — spec at `apps/holocron-web/e2e/holocron-research.spec.ts` (expert phrasing from `data/trask/eval/verification-queries.json`).
- **Batch corpus:** `bash scripts/trask_crawl_catalog.sh` (`trask-indexer crawl-seeds`) — operator Crawl4AI index of allowlist home URLs into Chroma before query-time recovery.
- **Discord:** `pnpm verify:trask-discord`.
- **Offline compose alignment:** `pnpm trask:faithfulness-eval` (fixtures under `data/trask-eval/fixtures/`).

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
export TRASK_INDEXER_BASE_URL=http://127.0.0.1:8787   # Worker (live stack)
echo '{"query":"TSLPatcher","query_domains":["deadlystream.com"]}' \
  | .venv-trask-research/bin/python scripts/trask_web_research.py
```
