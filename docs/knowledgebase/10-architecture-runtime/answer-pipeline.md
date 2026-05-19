---
title: Trask Answer Pipeline
owner: trask-bot
status: active
lastUpdated: 2026-05-18
---

# End-to-end flow

1. [REPO] User submits a question via Discord `/ask` or Holocron `POST /api/trask/ask` (`packages/trask-http`).
2. [REPO] `WebResearchClient` in `packages/trask` may pull **local** hits from a `SearchProvider` backed by `createChunkSearchProvider` (`FileChunkStore` under `INGEST_STATE_DIR`). See [trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md).
3. [REPO] Headless `scripts/trask_web_research.py` (Crawl4AI + DuckDuckGo) runs with approved web/GitHub URL roots (`traskApprovedResearchSources`); `kind=discord` catalog entries stay out of that allowlist.
4. [SYNTH] Local Discord chunk text is appended as lower-authority **context** in the research report path; citations can include `discord://approved-channels/...` URLs when chunks match.
5. [REPO] Answers are formatted with a `Sources` block; Discord uses embeds in `apps/trask-bot`; Holocron polls history per [trask-http-session-history-contract.md](trask-http-session-history-contract.md).

# Surfaces

- [REPO] `apps/trask-bot` — slash commands ([trask-discord-slash-contract.md](trask-discord-slash-contract.md)), optional proactive listener ([trask-proactive-mode-contract.md](trask-proactive-mode-contract.md)), optional embedded Holocron + `/api/trask` ([trask-embedded-holocron-web.md](trask-embedded-holocron-web.md)).
- [REPO] `apps/trask-http-server` — standalone API + static Holocron ([trask-http-server-standalone-contract.md](trask-http-server-standalone-contract.md)).
- [REPO] `apps/pazaak-bot` — mounts same Trask router at `/api/trask` for PazaakWorld ([pazaak-bot-trask-api-mount.md](pazaak-bot-trask-api-mount.md)).

# Related docs

- [discord-history-ingestion.md](discord-history-ingestion.md) — export/import shape.
- [trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md) — `WebResearchClient` + chunk merge.
- [trask-research-troubleshooting.md](../50-execution/trask-research-troubleshooting.md) — web research subprocess, timeouts, `INGEST_STATE_DIR`.
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
