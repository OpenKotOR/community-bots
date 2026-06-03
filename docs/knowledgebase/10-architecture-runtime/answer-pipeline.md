---
title: Trask Answer Pipeline
owner: trask-bot
status: active
lastUpdated: 2026-05-29
---

# Indexed research path (product default)

[SYNTH] Holocron and Discord share one **index-first** pipeline: weekly batch crawl → Chroma → Worker retrieve → grounded compose. Product requirements **REQ-A** (weekly refresh), **REQ-B** (cached corpus at query time), and **REQ-C** (30s budget) are defined in [trask-indexed-stack-runbook.md](../50-execution/trask-indexed-stack-runbook.md).

| Stage | What happens | Authority |
|-------|----------------|-----------|
| Corpus refresh (REQ-A) | Mondays 06:00 UTC: Cloudflare cron Worker or GitHub Actions → `POST /reindex` on indexer **:8790** → `crawl-seeds` batch into Chroma | [REPO] `infra/trask-reindex-scheduler`, `infra/trask-indexer/trask_indexer/retrieve_api.py` |
| Query retrieve | `scripts/trask_web_research.py` → `POST {TRASK_INDEXER_BASE_URL}/retrieve` on Worker **:8787** (not raw Chroma) | [REPO] `infra/trask-retrieve-worker`, `trask_live_stack.sh` |
| Hybrid ranking | Dense Chroma embedding query + lexical token overlap fused via RRF (k=60) + URL anchor boost → **bounded top-k** passage hits (`recall ≈ min(max(limit×3, 15), 30)`; not a full-corpus scan) | [REPO] `infra/trask-indexer/trask_indexer/chroma_store.py` |
| Live crawl (opt-in) | Only when `TRASK_WEB_RESEARCH_LIVE_CRAWL=1`; **off** on served stack (REQ-B) | [REPO] `scripts/trask_web_research.py`, `trask_live_stack.sh` default `0` |
| Budget (REQ-C) | `TRASK_RESEARCH_BUDGET_MS=30000` clamps gather subprocess + each compose LLM call | [REPO] `packages/config`, `trask_live_stack.sh` |
| Compose | Sufficiency gate → grounded compose with inline `[n]`; on fail or timeout → honest degrade | [REPO] `packages/trask` `grounded-evidence.ts` |

# End-to-end flow

1. [REPO] User submits a question via Discord `/ask` or Holocron `POST /api/trask/ask` (`packages/trask-http`).
2. [REPO] `ResearchWizardClient.fetchResearchReport` runs `scripts/trask_web_research.py` with approved web/GitHub URL roots (`traskApprovedResearchSources`); `kind=discord` catalog entries stay out of that allowlist. **Hot path does not merge `FileChunkStore` chunks** — see [trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md).
3. [REPO] Python gather calls **`POST /retrieve`** on `TRASK_INDEXER_BASE_URL` (Worker **:8787**). DDG and live crawl are recovery-only and off by default (`TRASK_WEB_RESEARCH_DDG_FALLBACK=0`, `TRASK_WEB_RESEARCH_LIVE_CRAWL=0` in `trask_live_stack.sh`).
4. [REPO] **`TRASK_GROUNDED_COMPOSE=1`** (default) enables extract-then-compose over passages (`grounded-evidence.ts`); **`approvedSources`** align to inline `[n]` citations (no padding).
5. [REPO] Answers include a `Sources` block and **`groundingStatus`** on HTTP/Holocron records; UI shows provenance per [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md).
6. [REPO] Discord uses embeds in `apps/trask-bot`; Holocron polls history per [trask-http-session-history-contract.md](trask-http-session-history-contract.md). Brief display runs `formatDiscordAskDisplay` after compose — [trask-citation-display-contract.md](trask-citation-display-contract.md).
7. [REPO] Offline citation gates: **`pnpm trask:gate`** (composite_score floor **165**). Live gates: **`pnpm holocron:e2e`**, **`pnpm verify:trask-cli`**, **`pnpm verify:trask-discord`** — matrix in [validation-ladder.md](../50-execution/validation-ladder.md) and [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md).

# Legacy / operator paths (not query hot path)

- [REPO] `createChunkSearchProvider` + `FileChunkStore` under `INGEST_STATE_DIR` — used for **`/queue-reindex`** enqueue and ingest-worker **FileChunkStore** drain, not merged into indexed retrieve answers.
- [REPO] Per-source catalog refresh: shared `reindex-queue.json` drained by **`trask-indexer drain-queue`** (Chroma) or **`ingest-worker drain-queue`** (FileChunkStore) — do not conflate with weekly **`POST /reindex`** (REQ-A). See [trask-reindex-queue-contract.md](trask-reindex-queue-contract.md).

# Surfaces

- [REPO] `apps/trask-bot` — slash commands ([trask-discord-slash-contract.md](trask-discord-slash-contract.md)), optional proactive listener ([trask-proactive-mode-contract.md](trask-proactive-mode-contract.md)), optional embedded Holocron + `/api/trask` ([trask-embedded-holocron-web.md](trask-embedded-holocron-web.md)).
- [REPO] `apps/trask-http-server` — standalone API + static Holocron ([trask-http-server-standalone-contract.md](trask-http-server-standalone-contract.md)).
- [REPO] `apps/pazaak-bot` — mounts same Trask router at `/api/trask` for PazaakWorld ([pazaak-bot-trask-api-mount.md](pazaak-bot-trask-api-mount.md)).

# Related docs

- [trask-indexed-stack-runbook.md](../50-execution/trask-indexed-stack-runbook.md) — operator stack, REQ-A/B/C, weekly refresh.
- [trask-research-agent-2026-standards.md](trask-research-agent-2026-standards.md) — mandatory pipeline summary.
- [discord-history-ingestion.md](discord-history-ingestion.md) — export/import shape.
- [trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md) — `ResearchWizardClient` + chunk store roles.
- [trask-research-troubleshooting.md](../50-execution/trask-research-troubleshooting.md) — research failures, timeouts, `INGEST_STATE_DIR`.
- [trask-reindex-queue-contract.md](trask-reindex-queue-contract.md) — catalog refresh queue + workers.
- [trask-runtime-map.md](trask-runtime-map.md) — package map.
- [trask-http-ask-contract.md](trask-http-ask-contract.md) — Holocron `POST /ask` behavior.
- [trask-http-session-history-contract.md](trask-http-session-history-contract.md) — session, history, thread, cancel, models, sources.
- [trask-discord-slash-contract.md](trask-discord-slash-contract.md) — Discord `/ask`, `/sources`, `/queue-reindex`.
- [trask-embedded-holocron-web.md](trask-embedded-holocron-web.md) — Holocron + `/api/trask` on the bot.
- [trask-http-server-standalone-contract.md](trask-http-server-standalone-contract.md) — `trask-http-server` process.
- [trask-proactive-mode-contract.md](trask-proactive-mode-contract.md) — optional message listener.
- [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md) — Holocron `trask-api.ts` + Vite.
- [pazaak-bot-trask-api-mount.md](pazaak-bot-trask-api-mount.md) — PazaakWorld `/api/trask` mount.
- [trask-citation-display-contract.md](trask-citation-display-contract.md) — citation markers and Discord display pipeline.
- [trask-citation-stack-closeout-2026-05-24.md](../../solutions/tooling-decisions/trask-citation-stack-closeout-2026-05-24.md) — citation arc **PR #33–#88**.
- [trask-citation-module-architecture-2026-05-24.md](../../solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md) — module map and gate table (PR #33–#85).
