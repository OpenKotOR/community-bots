---
title: Trask Runtime Map
owner: trask-bot
status: active
lastUpdated: 2026-05-24
---

# Runtime Surfaces

- [REPO] `apps/trask-bot` serves Discord slash `/ask`, `/sources`, and `/queue-reindex` ([trask-discord-slash-contract.md](trask-discord-slash-contract.md)); optional embedded Holocron on `TRASK_WEB_PORT` ([trask-embedded-holocron-web.md](trask-embedded-holocron-web.md)); optional proactive mode ([trask-proactive-mode-contract.md](trask-proactive-mode-contract.md)).
- [REPO] `apps/trask-http-server` mounts `/api/trask/*` and can serve `apps/holocron-web` static output ([trask-http-server-standalone-contract.md](trask-http-server-standalone-contract.md)).
- [REPO] `apps/pazaak-bot` mounts `/api/trask` on its HTTP API for PazaakWorld ([pazaak-bot-trask-api-mount.md](pazaak-bot-trask-api-mount.md)).
- [REPO] `apps/holocron-web` SPA calls `/api/trask` via `src/lib/trask-api.ts` ([holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md)).
- [REPO] `packages/trask-http` defines shared API contracts consumed by Discord and web surfaces (see [trask-http-ask-contract.md](trask-http-ask-contract.md), [trask-http-session-history-contract.md](trask-http-session-history-contract.md)); Discord slash behavior is [trask-discord-slash-contract.md](trask-discord-slash-contract.md).
- [REPO] `packages/trask` handles synthesis and source mapping for Trask answers ([trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md)); `packages/retrieval` supplies chunk store + catalog search merged into that path.
- [REPO] Citation stack in `packages/trask/src/`: `citation-markers.ts`, `research-answer-split.ts`, `query-anchor.ts`, `grounded-evidence.ts` (compose), `discord-reply-format.ts` (brief embed). Discord `/ask` uses `formatDiscordAskDisplay` — [trask-citation-display-contract.md](trask-citation-display-contract.md), [trask-citation-module-architecture-2026-05-24.md](../../solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md). Slash UX: [trask-discord-slash-contract.md](trask-discord-slash-contract.md).

# Storage And Retrieval

- [REPO] Query history persists as JSON via `JsonTraskQueryRepository`.
- [REPO] **Indexed research corpus:** Chroma on indexer host **:8790**; clients retrieve via Cloudflare Worker **:8787** only ([answer-pipeline.md](answer-pipeline.md), [trask-indexed-stack-runbook.md](../50-execution/trask-indexed-stack-runbook.md)).
- [REPO] Source chunks persist via `FileChunkStore` under `INGEST_STATE_DIR/chunks` (legacy/operator path; not merged on indexed hot path).
- [REPO] Catalog reindex jobs persist as **`reindex-queue.json`** (+ lock) under the same **`INGEST_STATE_DIR`**; drained by **`trask-indexer`** (Chroma) or **`ingest-worker`** (FileChunkStore) ([trask-reindex-queue-contract.md](trask-reindex-queue-contract.md)).
- [REPO] Source catalog includes `approved-discord-knowledge` but live research currently excludes `kind=discord`.

# Current Data Flow

See [answer-pipeline.md](answer-pipeline.md) for the full Discord + Holocron + local-chunk path. Summary:

1. [REPO] User asks in Discord or Holocron.
2. [REPO] Trask runs `scripts/trask_web_research.py` constrained to approved source roots.
3. [REPO] Trask formats answer plus sources and stores query history.
4. [SYNTH] Local chunk hits (including Discord export chunks) merge into synthesis as lower-authority context.

# Constraints

- [OFFICIAL] Message content visibility is intent and permission gated in Discord APIs.
- [REPO] Trask proactive mode already requires `guildMessages` + `messageContent` intents.
- [SYNTH] New welcome behavior should only require member events if welcome config is enabled.
