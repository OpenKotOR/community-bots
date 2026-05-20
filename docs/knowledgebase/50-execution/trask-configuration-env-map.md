---
title: Trask Configuration Environment Map
owner: trask-bot
status: active
lastUpdated: 2026-05-19
---

[SYNTH] Quick map of **Trask-related** process env vars to loaders in `packages/config/src/index.ts`. For narrative setup, see [docs/trask.md](../../trask.md).

# Dynamic product config (`@openkotor/trask-config`)

| Variable | Notes |
|----------|--------|
| `TRASK_GOLDEN_QUERIES_PATH` | [REPO] Override `data/trask/eval/golden-queries.json` (e2e, CLI, smoke, faithfulness). |
| `TRASK_POLICY_PATH` | [REPO] Override `data/trask/policy.json` (min citations, Discord caps, degraded patterns). |
| `TRASK_SURFACE_PROFILES_PATH` | [REPO] Override `data/trask/profiles/surfaces.json`. |
| `TRASK_LINGUISTICS_PATH` | [REPO] Override `data/trask/linguistics.json` (intent terms, anchor tokens). |
| `TRASK_RETRIEVAL_DEFAULTS_PATH` | [REPO] Override `data/trask/retrieval.defaults.json` (Node + `trask_web_research.py`). |
| `TRASK_PROMPT_DIR` | [REPO] Override `data/trask/prompts/` compose templates. |
| `TRASK_MIN_WEB_CITATIONS` | [REPO] Overrides `policy.json` `minWebCitations` at load time. |

# Shared

| Variable | Consumed by | Notes |
|----------|-------------|--------|
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | [REPO] `loadSharedAiConfig` — Trask bot, Trask HTTP server, ingest worker | Key fallback order per loader. |
| `OPENAI_BASE_URL`, `OPENAI_CHAT_MODEL`, `OPENAI_EMBEDDING_MODEL` | [REPO] `loadSharedAiConfig` | |
| `OPENROUTER_HTTP_REFERER`, `OPENROUTER_APP_TITLE` | [REPO] Optional OpenRouter headers | |
| `FIRECRAWL_API_KEY` | [REPO] Ingest + optional Trask AI bundle | Ingest uses Firecrawl for scraping when set. |
| `DATABASE_URL` | [REPO] `loadSharedAiConfig` | Passed through for embeddings / DB features when used. |
| `TRASK_REWRITE_MODEL_FALLBACKS` | [REPO] `loadSharedAiConfig` (`chatModelFallbacks`) | |

# Research wizard (Trask bot + Trask HTTP server)

| Variable | Notes |
|----------|--------|
| `TRASK_INDEXER_BASE_URL` | [REPO] Trask indexer retrieve API (default `http://127.0.0.1:8790`). |
| `TRASK_WEB_RESEARCH_PYTHON` | [REPO] Override Python; else `.venv-trask-research` from `scripts/bootstrap_trask_research.sh`. |
| `TRASK_WEB_RESEARCH_SCRIPT` | [REPO] Optional explicit path to `scripts/trask_web_research.py`. |
| `TRASK_RESEARCH_TIMEOUT_MS` | [REPO] Legacy overall budget (aliases `TRASK_RESEARCHWIZARD_TIMEOUT_MS`, default **900000**). |
| `TRASK_RESEARCH_GATHER_MS` | [REPO] Python gather subprocess wall clock (default **120000**). Discord clamps to **90s** SLA. |
| `TRASK_RESEARCH_COMPOSE_MS` | [REPO] Node LLM rewrite compose ceiling (default **60000**). |
| `TRASK_RESEARCHWIZARD_TIMEOUT_MS` | [REPO] Alias for `TRASK_RESEARCH_TIMEOUT_MS`. |
| `TRASK_FORCE_URL_VERIFY` | [REPO] When `1`, Node re-HEADs passages even if Python set `verified: true`. |
| `TRASK_GROUNDED_COMPOSE` | [REPO] When `0` / `false` / `no`, disables grounded compose. Default **on** (`groundedComposeEnabled` in `loadResearchWizardRuntimeConfig`). |
| `TRASK_RESEARCH_COMPOSE_MODE` | [REPO] `rewrite` enables legacy digest rewrite fallbacks; default `grounded`. |
| `TRASK_WEB_RESEARCH_DDG_FALLBACK` | [REPO] When `1` / `true`, Python runner may use DuckDuckGo only after empty Chroma retrieve (operator bootstrap; not used for compose when index miss). |
| `TRASK_INDEXER_DATA_DIR` | [REPO] Chroma persist dir (default `data/trask-indexer`). |
| `TRASK_DISCORD_SYNC_TIMEOUT_MS` | [REPO] Kill `trask_discord_sync.py` subprocess after N ms (default **600000**; `0` = no timeout). |

# Trask Discord bot (`loadTraskBotConfig`)

| Variable | Notes |
|----------|--------|
| `TRASK_DISCORD_APP_ID`, `TRASK_DISCORD_PUBLIC_KEY`, `TRASK_DISCORD_BOT_TOKEN` | [REPO] Required via `loadDiscordRuntimeConfig("TRASK", …)`. |
| `TRASK_DISCORD_CLIENT_SECRET` | [REPO] Optional (OAuth flows). |
| `TRASK_DISCORD_GUILD_ID` / `DISCORD_TARGET_GUILD_ID` | [REPO] Guild id fallback. |
| `TRASK_ALLOWED_GUILD_IDS` | [REPO] Allow-list; all listed guilds are exported when running `scripts/trask_discord_sync.py`. |
| `TRASK_DISCORD_CHANNEL_BLACKLIST` | [REPO] Channel IDs excluded from Discord export/indexing (comma-separated). |
| `TRASK_DISCORD_SYNC_INTERVAL_MS` | [REPO] When &gt; 0, Trask bot runs `scripts/trask_discord_sync.py` on an interval (Chroma path). |
| `TRASK_SLASH_GUILD_IDS` | [REPO] Guilds for slash registration. |
| `TRASK_APPROVED_CHANNEL_IDS`, `TRASK_PROACTIVE_CHANNEL_IDS` | [REPO] Proactive scoping. |
| `TRASK_PROACTIVE_ENABLED`, `TRASK_PROACTIVE_*` | [REPO] Debounce, cooldown, classifier, length limits (see `loadTraskBotConfig`). |
| `TRASK_WELCOME_CHANNEL_ID`, `TRASK_WELCOME_MESSAGE` | [REPO] Welcome surface when both set. |
| `INGEST_STATE_DIR` | [REPO] `chunkDir` for `createChunkSearchProvider` (default `data/ingest-worker`). On disk: `chunks/<sourceId>/*.json` under this dir (`FileChunkStore`); must match ingest writer and all answer runtimes ([trask-synthesis-and-chunk-retrieval.md](../10-architecture-runtime/trask-synthesis-and-chunk-retrieval.md), [trask-research-troubleshooting.md](trask-research-troubleshooting.md)). |
| `TRASK_QUERY_DATA_DIR` | [REPO] Directory for `trask-queries.json` (default `data/trask-bot`). |
| `TRASK_WEB_PORT`, `TRASK_SESSION_SECRET`, `TRASK_WEB_OAUTH_REDIRECT_URI` | [REPO] Embedded Holocron HTTP (`web-server`). |
| `TRASK_WEB_API_KEY`, `TRASK_WEB_ALLOW_ANONYMOUS`, `TRASK_WEB_DEFAULT_USER_ID` | [REPO] Web UI auth behavior (`resolveTraskWebAllowAnonymous`). |
| `TRASK_HOLOCRON_PUBLIC_URL` | [REPO] Link from `/ask` embeds to browser. |

# Runtime-only (apps read directly; not in `loadTraskBotConfig` / `loadTraskHttpServerConfig`)

| Variable | Where | Notes |
|----------|-------|--------|
| `TRASK_WEBUI_DIST_PATH` | [REPO] `apps/trask-bot/src/web-server.ts`, `apps/trask-http-server/src/main.ts` | Built Holocron `dist` directory override. |
| `NODE_ENV` | [REPO] `web-server.ts` | Sets `secure` on OAuth session cookie in production. |

# Holocron web (`apps/holocron-web`)

| Variable | Where | Notes |
|----------|-------|--------|
| `VITE_TRASK_API_BASE` | [REPO] `src/lib/trask-api.ts` (build-time) | Absolute Trask API origin; empty → same-origin fetches + `credentials: 'include'`. |
| `VITE_TRASK_API_KEY` | [REPO] `trask-api.ts` | Optional default Bearer key for builds. |
| `VITE_TRASK_FETCH_TIMEOUT_MS` | [REPO] `trask-api.ts` | Per-request timeout (min **3000** ms when set). |
| `TRASK_HTTP_PROXY_TARGET` | [REPO] `vite.config.ts` (Node, dev server) | Proxy `/api/trask` → this origin (default `http://127.0.0.1:4010`). |

# Trask HTTP server (`loadTraskHttpServerConfig`)

| Variable | Notes |
|----------|--------|
| `TRASK_HTTP_PORT` | [REPO] Default **4010**. |
| `TRASK_HTTP_DATA_DIR` | [REPO] Default `data/trask-http-server`. |
| `TRASK_PUBLIC_WEB_ORIGIN` | [REPO] CORS / browser origin. |
| `TRASK_WEB_API_KEY`, `TRASK_WEB_ALLOW_ANONYMOUS`, `TRASK_WEB_DEFAULT_USER_ID` | [REPO] Same semantics as bot web paths. |
| `INGEST_STATE_DIR` | [REPO] Chunk dir for HTTP runtime. Same on-disk layout as bot ([trask-research-troubleshooting.md](trask-research-troubleshooting.md)). |

# Pazaak bot (`loadPazaakBotConfig`, Trask mount)

| Variable | Notes |
|----------|--------|
| `PAZAAK_DATA_DIR` | [REPO] Default `data/pazaak-bot`; holds `trask-queries.json` for the Pazaak-mounted Trask router. |
| `INGEST_STATE_DIR` | [REPO] Chunk store path for `createChunkSearchProvider` on the Pazaak bot (same default as other apps). Must match ingest writer if using local chunks ([trask-research-troubleshooting.md](trask-research-troubleshooting.md)). |

# Ingest worker (`loadIngestWorkerConfig`)

| Variable | Notes |
|----------|--------|
| `INGEST_STATE_DIR` | [REPO] Chunk + queue state (default `data/ingest-worker`). Same path consumers use for `FileChunkStore` reads ([trask-research-troubleshooting.md](trask-research-troubleshooting.md)). |
| `loadSharedAiConfig` fields | [REPO] Used for `show-config` / future embedding paths. |

# Related

- [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md) — browser client + Vite `VITE_*` / proxy.
- [ingest-worker-cli-runbook.md](ingest-worker-cli-runbook.md) — CLI commands.
- [trask-http-session-history-contract.md](../10-architecture-runtime/trask-http-session-history-contract.md) — HTTP surfaces (high level).
- [trask-embedded-holocron-web.md](../10-architecture-runtime/trask-embedded-holocron-web.md) — bot-hosted web auth (cookie + API key).
- [trask-http-server-standalone-contract.md](../10-architecture-runtime/trask-http-server-standalone-contract.md) — standalone server auth (API key / anonymous only).
- [pazaak-bot-trask-api-mount.md](../10-architecture-runtime/pazaak-bot-trask-api-mount.md) — Pazaak `/api/trask` + `PAZAAK_DATA_DIR`.
- [trask-synthesis-and-chunk-retrieval.md](../10-architecture-runtime/trask-synthesis-and-chunk-retrieval.md) — how `INGEST_STATE_DIR` feeds chunk search.
- [trask-research-troubleshooting.md](trask-research-troubleshooting.md) — state path mismatches.
- [trask-reindex-queue-contract.md](../10-architecture-runtime/trask-reindex-queue-contract.md) — catalog reindex queue vs Discord chunk import.
