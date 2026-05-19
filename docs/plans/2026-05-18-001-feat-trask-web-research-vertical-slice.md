---
status: completed
name: Trask web research vertical slice
origin:
  - STRATEGY.md
  - docs/trask-research-backends.md
created: 2026-05-18
---

# Trask / Holocron research vertical slice

## Problem frame

Finish and ship the in-flight migration from vendored GPT-Researcher to Crawl4AI + DuckDuckGo web research with community Discord context, Holocron server-backed Q&A, and deploy/ops parity.

## Scope boundaries

**In scope**

- Complete migration off `gpt-researcher-subprocess` / `vendor/ai-researchwizard`
- Wire and test: `packages/trask/src/web-research-subprocess.ts`, `packages/trask/src/community-knowledge.ts`, `packages/retrieval/src/discord-permalink.ts`
- `apps/trask-bot/src/discord-channel-search.ts` integration in bot main
- Holocron: server-backed QA only; remove dead client scraper/agent/prompts UI
- Docs + env examples + HF Docker/workflow parity
- Restore meaningful unit tests; run full verification ladder

**Out of scope**

- New research backends (SearXNG, Khoj, Firecrawl answer path)
- PazaakWorld / Nakama work
- Unrelated holocron TOTJ visual plan

## Implementation units

### U1: Branch and workspace hygiene

- Create `feat/trask-web-research-ship` from `main`
- Stage all intentional untracked files; finalize `vendor/ai-researchwizard` submodule removal

**Verification:** clean `git status` per commit boundaries

### U2: Source-runtime parity — docs and env

**Modify:** `docs/trask.md`, `docs/setup.md`, `docs/architecture.md`, `.env.local.example`, `apps/trask-http-server/.env.example`, `apps/trask-bot/.env.example`, `.github/workflows/trask-http-public.yml`

- Primary narrative: `TRASK_WEB_RESEARCH_*` + `scripts/bootstrap_trask_research.sh`
- Deprecated alias notes only where `packages/config/src/index.ts` still reads them

**Verification:** `rg 'ai-researchwizard|gpt_researcher|trask_headless_research'` returns only migration/deprecated mentions

### U3: Trask package — tests and subprocess contract

**Modify:** `packages/trask/src/research-wizard.test.ts`

**Test scenarios:** community source merge/digest; config alias fallback; wizard factory smoke

**Execution note:** characterization-first for reintroduced behavior

**Verification:** `pnpm build && pnpm test`

### U4: Discord live search + bot/http integration

**Files:** `apps/trask-bot/src/discord-channel-search.ts`, `apps/trask-bot/src/main.ts`, `apps/trask-http-server/src/main.ts`, `packages/trask-http/src/router.ts`

**Verification:** unit tests pass

### U5: Holocron UI cleanup

**Files:** `apps/holocron-web/src/App.tsx`, `Message.tsx`, `SourceWeightsDialog.tsx`, `types.ts`

**Verification:** workspace build

### U6: Deploy surface

**Files:** `infra/trask-http-public/`, `scripts/pack-trask-http-hf-context.sh`, `scripts/holocron-e2e-live-server.sh`

**Verification:** `python scripts/smoke_trask_web_research.py --dry-run`

### U7: Verification ladder

```bash
bash scripts/bootstrap_trask_research.sh
pnpm build && pnpm check && pnpm test
python scripts/smoke_trask_web_research.py --dry-run
node scripts/holocron-e2e-live-build.mjs
TRASK_WEB_ALLOW_ANONYMOUS=1 bash scripts/holocron-e2e-live-server.sh
pnpm holocron:e2e
```

## Success criteria

- Single authoritative research path end-to-end in browser
- No stale primary docs pointing at removed vendor tree
- `STRATEGY.md` aligned with shipped scope
- `pnpm test` + full `pnpm holocron:e2e` green
- PR from feature branch
