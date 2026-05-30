---
title: Trask Knowledgebase Validation Ladder
owner: trask-bot
status: active
lastUpdated: 2026-05-29
---

[SYNTH] Narrowest checks first; widen only when needed (matches vertical-slice discipline).

## 1. Docs

- [SYNTH] Every non-trivial claim in `docs/knowledgebase/**` carries `[USER]`, `[REPO]`, `[OFFICIAL]`, `[DISCORD_EXPORT]`, `[SYNTH]`, or `[OPEN]`.
- [SYNTH] `git diff --check` clean for whitespace errors.

## 2. TypeScript build

- [REPO] From repo root: `npx tsc -b tsconfig.workspace.json --pretty false` (or `pnpm check` when pnpm is available).

## 3. Citation offline gate

- [REPO] **Recommended preflight:** `pnpm trask:gate` — one `pnpm build`, import smoke (`trask:smoke-imports:ci`), **`pnpm trask:config-drift`**, full `optimize-measure` with `TRASK_SKIP_BUILD` and `TRASK_OPTIMIZE_SKIP_CHECK`, then `trask:optimize-measure:ci`; both measure runs must reach **composite_score** **165**.
- [REPO] **CI offline (after build):** `pnpm trask:gate:ci` — same as smoke-imports + config-drift + `trask:optimize-measure:ci` (no full local measure). Run locally as `pnpm build && pnpm trask:gate:ci`.
- [REPO] **Full local measure:** `pnpm trask:optimize-measure` — faithfulness + discord stress + citation helper unit suites (`research-answer-split`, `query-anchor`, `citation-markers`, `grounded-evidence`, `research-compose`) + `pnpm check`.
- [REPO] **CI measure:** `pnpm trask:optimize-measure:ci` — faithfulness + discord stress only; enforces **composite_score ≥ 165** without duplicating the full Trask unit matrix (see [trask-citation-module-architecture-2026-05-24.md](../../solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md)).
- [SYNTH] Authoritative formula and incident history: [trask-citation-display-contract.md](../10-architecture-runtime/trask-citation-display-contract.md), [trask-discord-dual-citation-line-filter-2026-05-24.md](../../solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md).
- [REPO] `pnpm verify:trask-discord`, `pnpm verify:trask-cli`, and `pnpm holocron:e2e` preflight with `pnpm trask:gate` before live or browser steps; live verify scripts and Holocron Playwright `webServer` auto-bootstrap indexer+Worker (**8787**/**8790**) via `trask_qa_stack_bootstrap.mjs` when unhealthy — see [trask-qa-stack-bootstrap-2026-05-24.md](../../solutions/tooling-decisions/trask-qa-stack-bootstrap-2026-05-24.md).

## 4. Package tests

- [REPO] `pnpm --filter @openkotor/trask test` or `node --test packages/trask/dist/*.test.js` after `tsc -b` for `@openkotor/trask`.
- [REPO] Ingest Discord import: `node --test apps/ingest-worker/dist/discord-export-import.test.js` after workspace build (uses [fixtures/discord-export-minimal](../../../fixtures/discord-export-minimal)).

## 5. Ingest importer (local)

- [SYNTH] `import-discord-export fixtures/discord-export-minimal --dry-run` (from repo root; see [fixtures/discord-export-minimal/README.md](../../../fixtures/discord-export-minimal/README.md)); confirm logged chunk counts and no throw.
- [SYNTH] `show-indexed` lists `approved-discord-knowledge` with non-zero chunks after a real import.
- [SYNTH] **Per-source catalog queue** (`/queue-reindex` or ingest-worker CLI `queue-reindex`) writes to **`INGEST_STATE_DIR/reindex-queue.json`**. Drain target depends on corpus store — do not mix workers on the same queue:
  - **Indexed Chroma path (Holocron/Discord research default):** `bash scripts/trask_indexer_drain_queue.sh` or `trask-indexer run-queue-worker` → Crawl4AI → Chroma ([trask-indexed-stack-runbook.md](trask-indexed-stack-runbook.md)).
  - **FileChunkStore path (legacy local chunks):** `ingest-worker drain-queue` or `run-queue-worker` → `FileChunkStore` under `INGEST_STATE_DIR` ([ingest-worker-cli-runbook.md](ingest-worker-cli-runbook.md)).
- [SYNTH] **Weekly full-catalog refresh (REQ-A)** is separate: `POST /reindex` on indexer **:8790** (cron Worker or `trask-weekly-reindex.yml`), not the per-source queue. See [trask-indexed-stack-runbook.md](trask-indexed-stack-runbook.md) § Weekly corpus refresh.

## 6. Runtime smoke (optional)

- [REPO] `pnpm trask:smoke:stack-bootstrap` — shared QA env + `ensure_trask_indexed_stack_for_e2e.sh` + `pnpm trask:stack:health` (see [trask-qa-stack-bootstrap-2026-05-24.md](../../solutions/tooling-decisions/trask-qa-stack-bootstrap-2026-05-24.md)).
- [REPO] CI: after indexer+Worker start → `trask:smoke:stack-bootstrap` → **`trask:verify-import-smoke:ci`** → `holocron:e2e:playwright`. Import-smoke exercises **all five** canonical golden queries (CLI golden wording; Discord expert wording via `goldenQueryId`). Debug individually with `verify:trask-discord:ci` / `verify:trask-cli:ci`.
- [REPO] Holocron Playwright (`apps/holocron-web/playwright.config.ts`): **`retries: 1` when `CI` is set** (0 locally) for flaky live-research timing; does not replace fixing retrieval or compose regressions.
- [REPO] Failure-path Holocron e2e (`playwright.failure.config.ts`, `HOLOCRON_E2E_FAILURE_MODE=1`): unreachable indexer → `groundingStatus: failed` + classifiable `liveTrace` (runs after happy-path in `holocron:e2e:playwright`).
- [REPO] Happy-path Holocron e2e: when `groundingStatus === 'grounded'`, `liveTrace` includes gather `diag.research_done` (Plan 006 U2 v1.1 / #87).
- [REPO] HTTP contracts for Holocron: [trask-http-ask-contract.md](../10-architecture-runtime/trask-http-ask-contract.md), [trask-http-session-history-contract.md](../10-architecture-runtime/trask-http-session-history-contract.md); host wiring: [trask-embedded-holocron-web.md](../10-architecture-runtime/trask-embedded-holocron-web.md), [trask-http-server-standalone-contract.md](../10-architecture-runtime/trask-http-server-standalone-contract.md).
- [REPO] Env map: [trask-configuration-env-map.md](trask-configuration-env-map.md).
- [REPO] Holocron Vite dev client: [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md) (`TRASK_HTTP_PROXY_TARGET`, optional `VITE_TRASK_API_BASE`).
- [REPO] `bash scripts/bootstrap_trask_research.sh` and `pnpm smoke:trask-research` verify the research stack.
- [SYNTH] Holocron E2E against built static + `trask-http-server` as documented in `docs/trask.md` (requires auth env as configured).

## 7. Discord (manual)

- [SYNTH] `/ask` in an approved channel returns embed + sources.
- [SYNTH] With welcome env set, a test join posts only in the configured channel with safe mentions.

## 8. Holocron validation matrix

[SYNTH] Canonical query set: five expert phrasings in `data/trask/eval/verification-queries.json` (Playwright/browser); CLI/import-smoke uses `data/trask/eval/golden-queries.json`.

| Surface | Command / action | Stack | Queries | Pass criteria |
|---------|------------------|-------|---------|---------------|
| Offline citation | `pnpm trask:gate` / `pnpm trask:gate:ci` | build only | fixtures | `composite_score` ≥ **165**; config-drift clean |
| Import smoke (indexed) | `pnpm trask:verify-import-smoke:ci` | auto-bootstrap **8787**/**8790** | 5 golden (CLI + Discord wording) | substantive answer; AE3 stderr clean |
| Holocron Playwright | `pnpm holocron:e2e` / `holocron:e2e:playwright` | Worker retrieve + `trask-http-server` **:4010** | 5 verification-queries | answer on-topic; **≥2** `https://` citations; `groundingStatus` grounded when expected; no stuck **Thinking** (~200s) |
| Holocron browser MCP | Cursor browser on **http://127.0.0.1:4010** | same as Playwright | same 5; fresh `?thread=<uuid>` each | same as Playwright row |
| CLI live | `pnpm verify:trask-cli` | auto-bootstrap **8787**/**8790** | golden-queries | on-topic + citations per script |
| Discord live | `pnpm verify:trask-discord` | auto-bootstrap + bot token | golden + expert | embed contract per [trask-discord-slash-contract.md](../10-architecture-runtime/trask-discord-slash-contract.md) |
| Public Pages | manual **qa-webui** URL after deploy | `VITE_TRASK_API_BASE` → live worker API | **1** spot-check (not full matrix) | **≥2** `https://` sources on representative query |

[REPO] Retrieve path for all live rows: `TRASK_INDEXER_BASE_URL=http://127.0.0.1:8787` (Worker), not raw Chroma **:8790**. [REPO] Served stack defaults: `TRASK_WEB_RESEARCH_LIVE_CRAWL=0` (REQ-B), `TRASK_RESEARCH_BUDGET_MS=30000` (REQ-C).

Detail: [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md).

## 9. Public Holocron (GitHub Pages)

- [REPO] After deploy: open **`https://openkotor.github.io/community-bots/qa-webui/?thread=<fresh-uuid>`** with live **`VITE_TRASK_API_BASE`** / worker research backend — see [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md).
- [SYNTH] Spot-check **one** query with **≥2** `https://` sources per matrix §8; full five-query gate remains **`pnpm holocron:e2e`** on **:4010** and Cursor browser MCP per **`AGENTS.md`**.
