---
title: Trask Answer Pipeline
owner: trask-bot
status: active
lastUpdated: 2026-05-19
---

# End-to-end flow

1. [REPO] User submits a question via Discord `/ask` or Holocron `POST /api/trask/ask` (`packages/trask-http`).
2. [REPO] `ResearchWizardClient` in `packages/trask` may pull **local** hits from a `SearchProvider` backed by `createChunkSearchProvider` (`FileChunkStore` under `INGEST_STATE_DIR`). See [trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md).
3. [REPO] `scripts/trask_web_research.py` runs with approved web/GitHub URL roots (`traskApprovedResearchSources`); `kind=discord` catalog entries stay out of that allowlist.
4. [SYNTH] Local chunk text is merged into the research report as lower-authority context for grounded compose or rewrite; public citations remain **`https://`** on approved hosts only.
5. [REPO] Optional **`TRASK_GROUNDED_COMPOSE=1`** enables extract-then-compose over the report (`grounded-evidence.ts`); **`approvedSources`** are aligned to inline `[n]` citations (no padding).
6. [REPO] Answers include a `Sources` block and **`groundingStatus`** on HTTP/Holocron records; UI shows provenance (cited vs consulted) per [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md).
7. [REPO] Discord uses embeds in `apps/trask-bot`; Holocron polls history per [trask-http-session-history-contract.md](trask-http-session-history-contract.md).
8. [REPO] Offline citation alignment: `pnpm trask:faithfulness-eval` replays `data/trask-eval/fixtures/` against [golden-queries.json](../../../data/trask-eval/golden-queries.json).

# Surfaces

- [REPO] `apps/trask-bot` — slash commands ([trask-discord-slash-contract.md](trask-discord-slash-contract.md)), optional proactive listener ([trask-proactive-mode-contract.md](trask-proactive-mode-contract.md)), optional embedded Holocron + `/api/trask` ([trask-embedded-holocron-web.md](trask-embedded-holocron-web.md)).
- [REPO] `apps/trask-http-server` — standalone API + static Holocron ([trask-http-server-standalone-contract.md](trask-http-server-standalone-contract.md)).
- [REPO] `apps/pazaak-bot` — mounts same Trask router at `/api/trask` for PazaakWorld ([pazaak-bot-trask-api-mount.md](pazaak-bot-trask-api-mount.md)).

# Related docs

- [discord-history-ingestion.md](discord-history-ingestion.md) — export/import shape.
- [trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md) — `ResearchWizardClient` + chunk merge.
- [trask-research-troubleshooting.md](../50-execution/trask-research-troubleshooting.md) — research failures, timeouts, `INGEST_STATE_DIR`.
- [trask-reindex-queue-contract.md](trask-reindex-queue-contract.md) — catalog refresh queue + worker.
- [trask-runtime-map.md](trask-runtime-map.md) — package map.
- [trask-http-ask-contract.md](trask-http-ask-contract.md) — Holocron `POST /ask` behavior.
- [trask-http-session-history-contract.md](trask-http-session-history-contract.md) — session, history, thread, cancel, models, sources.
- [trask-discord-slash-contract.md](trask-discord-slash-contract.md) — Discord `/ask`, `/sources`, `/queue-reindex`.
- [trask-embedded-holocron-web.md](trask-embedded-holocron-web.md) — Holocron + `/api/trask` on the bot.
- [trask-http-server-standalone-contract.md](trask-http-server-standalone-contract.md) — `trask-http-server` process.
- [trask-proactive-mode-contract.md](trask-proactive-mode-contract.md) — optional message listener.
- [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md) — Holocron `trask-api.ts` + Vite.
- [pazaak-bot-trask-api-mount.md](pazaak-bot-trask-api-mount.md) — PazaakWorld `/api/trask` mount.
