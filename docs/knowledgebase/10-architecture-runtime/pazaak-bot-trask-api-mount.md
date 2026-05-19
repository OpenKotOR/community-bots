---
title: Pazaak Bot Trask API Mount
owner: pazaak-bot
status: active
lastUpdated: 2026-05-20
---

# Mount

- [REPO] `apps/pazaak-bot/src/api-server.ts` mounts **`createTraskHttpRouter`** at **`/api/trask`** with `runtime: opts.trask` when Trask options are wired from `main.ts`.

# Auth

- [REPO] **`auth: { requireAuth: withAuth }`** where `withAuth` wraps handlers with **`createRequiredAuthHandler`** and Discord **Bearer** token resolvers (`authorization` header) — not the Trask HTTP server’s API-key-only shim; callers must present a valid Discord access token for the Pazaak API’s auth model.

# Runtime payload

- [REPO] `apps/pazaak-bot/src/main.ts` wires `createChunkSearchProvider(process.env.INGEST_STATE_DIR?.trim() || "data/ingest-worker")` and `createWebResearchClient(...)` into the `trask` option object as **`webResearch`**.
- [REPO] `JsonTraskQueryRepository` under **`resolveDataFile(config.dataDir, "trask-queries.json")`** where `dataDir` comes from **`PAZAAK_DATA_DIR`** (default `data/pazaak-bot`, `loadPazaakBotConfig`).

# Purpose

- [SYNTH] Exposes the same Trask Q&A surface as Holocron for **PazaakWorld** clients that already talk to the Pazaak bot HTTP server (e.g. OAuth token exchange and `/api/trask/*` per `AGENTS.md`).

# Related

- [answer-pipeline.md](../10-architecture-runtime/answer-pipeline.md) — end-to-end surfaces.
- [trask-http-ask-contract.md](../10-architecture-runtime/trask-http-ask-contract.md) — HTTP semantics (auth differs per host).
