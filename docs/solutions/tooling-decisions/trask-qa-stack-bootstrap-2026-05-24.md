---
title: "Trask QA stack auto-bootstrap (PR #66–#68)"
date: 2026-05-24
category: tooling-decisions
problem_type: workflow
component: trask
module: trask
tags:
  - trask
  - bootstrap
  - qa
  - holocron
  - e2e
applies_when: "Running live Trask QA (Holocron e2e, CLI verify, Discord verify) on a cold machine"
---

## Problem

Holocron e2e, `verify:trask-cli`, and `verify:trask-discord` all need Chroma indexer (**8790**) and retrieve Worker (**8787**). Requiring `bash scripts/trask_live_stack.sh` before each gate was easy to forget and inconsistent across surfaces.

## Solution

Shared Node helper **`scripts/lib/trask_qa_stack_bootstrap.mjs`**:

1. **`applyTraskQaStackEnv(repoRoot)`** — CI-parity defaults:
   - `TRASK_INDEXER_BASE_URL=http://127.0.0.1:8787` (Worker, not raw Chroma)
   - `TRASK_QA_GROUNDING=1`, `TRASK_LLM_PROFILE=free`
   - `TRASK_WEB_RESEARCH_DDG_FALLBACK=0`, `TRASK_RESEARCH_COMPOSE_MODE=grounded`
   - `TRASK_WEB_RESEARCH_PYTHON` → `.venv-trask-indexer/bin/python` when unset
2. **`bootstrapTraskIndexedStack(repoRoot)`** — runs **`bash scripts/ensure_trask_indexed_stack_for_e2e.sh`** with inherited env.

### Call graph

```text
trask_qa_stack_bootstrap.mjs
  └─ ensure_trask_indexed_stack_for_e2e.sh
       ├─ (if unhealthy) bootstrap_trask_indexer.sh + trask_index_seed_for_qa.sh
       ├─ trask-indexer serve :8790
       └─ wrangler dev :8787 → indexer :8790
```

Holocron Playwright adds **`holocron-e2e-webserver.mjs`**: same bootstrap, then `TRASK_WEB_ALLOW_ANONYMOUS=1`, `TRASK_HTTP_PORT=4010`, and `holocron-e2e-live-server.sh` on **4010**.

### Consumers

| Surface | Entry |
|---------|--------|
| Holocron e2e | `scripts/holocron-e2e-webserver.mjs` (Playwright `webServer`) |
| CLI verify | `scripts/verify_trask_cli_qa.mjs` |
| Discord verify | `scripts/verify_trask_discord_live.mjs` |

### Escape hatches

| Variable | Effect |
|----------|--------|
| `HOLOCRON_E2E_SKIP_STACK_BOOTSTRAP=1` | `ensure_trask_indexed_stack_for_e2e.sh` fails if stack unhealthy (CI/local when you manage ports yourself) |
| `TRASK_INDEXER_PORT` / `TRASK_RETRIEVE_WORKER_PORT` | Override defaults **8790** / **8787** |

### CI vs local

- **GitHub Actions** pre-starts indexer + Worker before `pnpm holocron:e2e:playwright`, then runs **`ensure_trask_indexed_stack_for_e2e.sh`** as an idempotent smoke (same script local agents use).
- **Local Playwright** relies on `holocron-e2e-webserver.mjs` when the stack is down; warm runs log `indexer + Worker already healthy` and exit 0.

### Hygiene

Delete stale local branch `feat/your-next-change` when no longer needed: `git branch -d feat/your-next-change`.

## Verification

```bash
pnpm trask:gate
pnpm trask:smoke:stack-bootstrap   # bootstrap + health (CI uses this)
pnpm verify:trask-discord:ci         # static Discord embed smoke (CI, no token)
pnpm holocron:e2e                    # gate preflight + Playwright
```

## Related

- [trask-citation-stack-closeout-2026-05-24.md](trask-citation-stack-closeout-2026-05-24.md) — PR #66–#68 rows
- [trask-indexed-stack-runbook.md](../../knowledgebase/50-execution/trask-indexed-stack-runbook.md)
- [validation-ladder.md](../../knowledgebase/50-execution/validation-ladder.md)
