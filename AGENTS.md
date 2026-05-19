## Learned User Preferences

- Do not install, enable, or recommend the **Runlayer** Cursor marketplace plugin (MCP governance hooks block browser/MCP tools without tenant login).
- Prefer taking full initiative: run commands, start services, and verify behavior in this environment instead of telling the user to perform manual setup or testing steps themselves.
- Holocron live research uses **Crawl4AI indexer + DuckDuckGo** (`scripts/trask_web_research.py`, `infra/trask-indexer`) and Node LLM synthesis; bootstrap with `bash scripts/bootstrap_trask_research.sh`. `docs/solutions/` holds documented fixes and cutovers (YAML frontmatter: `module`, `tags`, `problem_type`).

## Learned Workspace Facts

- **PazaakWorld gameplay** (authoritative matches, RPCs, realtime): local/dev uses **Nakama** (`infra/nakama`, `@openkotor/pazaak-nakama` runtime). Point the client with `VITE_PAZAAK_BACKEND=nakama` (or set `VITE_NAKAMA_HOST`) and keep `VITE_LEGACY_HTTP_ORIGIN=http://localhost:4001` when you still need the bot for OAuth token exchange and `/api/trask/*`. Older Cloudflare Worker + Durable Object paths remain in-repo for reference but are not the primary gameplay backend for the Nakama cutover.
- **PazaakWorld HTTP API failover** (non-Nakama paths): `@openkotor/platform` `createBrowserApiClient` walks comma-separated `VITE_API_BASES` in order and retries the next origin on **network errors or 5xx** (4xx does not hop). **`VITE_LEGACY_HTTP_ORIGIN`** origins are **prepended** (deduped) before `VITE_API_BASES`, so Pages can set `VITE_LEGACY_HTTP_ORIGIN` to a public bot and `PAZAAK_API_BASES` to a Cloudflare Worker URL for bot-first → Worker fallback. Worker lives in `infra/pazaak-matchmaking-worker`; CI runs `wrangler deploy --dry-run` in `.github/workflows/pazaak-matchmaking-worker.yml` without secrets; live deploy needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
- **PazaakWorld on GitHub Pages** (static client only): `OpenKotOR/community-bots` is published at `https://openkotor.github.io/community-bots/`; CI and Vite should use `BASE=/community-bots/` (and `import.meta.env.BASE_URL` in app code). Treat legacy `/bots/` org URLs as mismatched with the renamed repo unless a separate redirect or `bots` Pages repo exists.
- For KotOR-authentic color theming in PazaakWorld (including fixing mismatched labels like “KotOR classic”), reference OpenKotOR ModSync’s K1 and TSL theme definitions rather than inventing standalone palettes.
- **Trask / Holocron:** UI in **`apps/holocron-web`**; API in **`apps/trask-http-server`** (`/api/trask/*`, serves built Holocron on port **4010**). Live research: **`scripts/trask_web_research.py`** (indexer `POST /retrieve` at `TRASK_INDEXER_BASE_URL`, local Chroma, DuckDuckGo fallback; stdout includes structured **`passages`**) + **grounded compose** in `@openkotor/trask` (`TRASK_GROUNDED_COMPOSE` on by default; set `0`/`false` to disable digest rewrite). Bootstrap: `bash scripts/bootstrap_trask_research.sh`; set `TRASK_WEB_RESEARCH_PYTHON` and `OPENAI_API_KEY` or `OPENROUTER_API_KEY`. **Discord RAG:** index all readable channels except `TRASK_DISCORD_CHANNEL_BLACKLIST`; bot auto-sync when `TRASK_DISCORD_SYNC_INTERVAL_MS` > 0 (`scripts/trask_discord_sync.py`). Holocron allows anonymous `/api/trask/*` when `TRASK_WEB_ALLOW_ANONYMOUS=1`. `TRASK_RESEARCH_TIMEOUT_MS` (alias `TRASK_RESEARCHWIZARD_TIMEOUT_MS`) defaults to **900000** ms. **Public Holocron:** `TRASK_API_BASE` on the Trask worker with **`TRASK_BUILTIN_API=0`** and live `trask-http-server` (`infra/trask-http-public/`).

## Cursor Cloud specific instructions

### Environment overview

- **Runtime**: Node.js ≥24, pnpm 10.11.0 (via corepack)
- **Monorepo**: pnpm workspaces — `apps/*`, `packages/*`, `infra/*`
- **Build**: `pnpm build` (runs `tsc -b tsconfig.workspace.json`)
- **Type check**: `pnpm check`
- **Lint**: `pnpm --filter pazaak-world lint` (only pazaak-world has eslint config currently)
- **Tests**: `pnpm test` (shorthand for `node --test packages/*/dist/*.test.js apps/*/dist/*.test.js`, Node.js built-in runner; build first). `pnpm test:watch` for interactive watch mode.

### Build scripts (esbuild)

After `pnpm install`, you must run `pnpm rebuild esbuild` once per clean install because esbuild's postinstall is blocked by the `onlyBuiltDependencies` allow-list in `pnpm-workspace.yaml`. Without the rebuild, the pazaak-nakama bundle step will fail (esbuild binary missing). This does not affect the main TypeScript workspace build or the Vite-based dev servers.

### Running dev servers

Standard scripts from `package.json`:
- `pnpm dev:pazaak-world` — Vite dev server for the card game SPA (port 5173)
- `pnpm dev:holocron-web` — Vite dev server for the KOTOR knowledge base (port 5174 if 5173 is taken)
- `pnpm dev:hk86-web` — static Discord bots hub page
- `pnpm dev:trask-http` — REST + static serve for holocron-web
- `pnpm dev:pazaak` — Discord Pazaak Bot (needs `PAZAAK_DISCORD_BOT_TOKEN`)
- `pnpm dev:trask` — Discord Trask Bot (needs `TRASK_DISCORD_BOT_TOKEN`)
- `pnpm dev:hk` — Discord HK Bot (needs `HK_DISCORD_BOT_TOKEN`)

### Gotchas

- The pazaak-world app renders a dark/space-themed animated background on load; without a backend (bot or Nakama), the main menu card content may not render — this is expected when no API is reachable.
- `trask-http` tests have 2 pre-existing flaky failures around temp-file rename race conditions under `/tmp`; these are not environment issues.
- holocron-web uses TypeScript ~5.7 while the rest of the workspace uses ~6.0; Vite handles each independently.
- The `package-lock.json` at root is legacy/stale; pnpm is the authoritative package manager.

### Holocron / Trask web UI — functional testing (agents)

**Requirement:** Do not claim Holocron search/research is working until you have **fully verified it in a real browser** — all five canonical research queries must complete with substantive answers and sources. Use Playwright (`pnpm holocron:e2e`) as the mandatory automated gate; use the Cursor **browser** MCP for an extra manual pass when it is available. A single happy-path click or CLI-only check is not sufficient.

Holocron e2e is **functional only** (no mocked `/api/trask` routes, no UI regression fixtures). The single spec is `apps/holocron-web/e2e/holocron-research.spec.ts`.

#### Mandatory verification (run before “done”)

1. Ensure **`trask-http-server`** serves built Holocron on **http://127.0.0.1:4010** (`TRASK_WEB_ALLOW_ANONYMOUS=1`).
2. Seed Chroma for the five golden queries: `bash scripts/bootstrap_trask_indexer.sh`, `bash scripts/trask_index_seed_for_qa.sh`, and `trask-indexer serve` on `TRASK_INDEXER_BASE_URL` (CI does this automatically before e2e).
3. Run the **full** Playwright suite (all five searches — not a subset):

```bash
pnpm exec playwright install chromium --with-deps   # once per machine
pnpm holocron:e2e
# server already listening:
HOLOCRON_REUSE_SERVER=1 pnpm holocron:e2e
```

4. When the Cursor **browser** MCP is available, you must run **all five** canonical queries in the web UI (not a subset). Use a **fresh** `?thread=<uuid>` per query so history does not bleed across tests. Workflow: `browser_navigate` → `browser_lock` → fill **Question input** → **Submit question** (only after the button is enabled) → wait until **Thinking** clears and an assistant message plus citation links appear → `browser_unlock` when finished. Report pass/fail per query in your completion message. Playwright alone does **not** satisfy this step when browser MCP works.
5. If the task touches deployed/public Holocron behavior, also verify **`https://openkotor.github.io/community-bots/qa-webui/?thread=<fresh-uuid>`** in a real browser after deploy. Keep `TRASK_API_BASE` on the Trask worker with **`TRASK_BUILTIN_API=0`** and a live research backend, then confirm at least one public query returns **multiple `https://` sources** before reporting success.

**Pass criteria (each of the five queries):** question input enabled → submit → user message visible → assistant answer substantive and on-topic → no stuck **Thinking** (≤ ~200s) → **Sources** panel or visible `https://` citations (≥2) on approved hosts.

**Canonical five queries** (defined in `holocron-research.spec.ts`):

1. What is TSLPatcher used for in KOTOR modding?
2. How do I troubleshoot KOTOR widescreen resolution issues on PC?
3. What is MDLOps used for in the KOTOR toolchain?
4. Where are Knights of the Old Republic save files stored on Windows?
5. What does the reone project provide for Odyssey engine work?

#### Restart stack (required before browser or e2e)

Stale `trask-http-server` / Playwright / Vite processes cause `ERR_CONNECTION_REFUSED` or wrong API origin. **Kill listeners and old servers first**, then start clean:

```bash
# Free Holocron e2e port and common dev ports (Linux)
fuser -k 4010/tcp 2>/dev/null || true
fuser -k 5173/tcp 5174/tcp 4174/tcp 7860/tcp 2>/dev/null || true
pkill -f 'holocron-e2e-live-server' 2>/dev/null || true
pkill -f 'trask-http-server' 2>/dev/null || true
pkill -f 'playwright.*holocron' 2>/dev/null || true

node scripts/holocron-e2e-live-build.mjs
TRASK_WEB_ALLOW_ANONYMOUS=1 bash scripts/holocron-e2e-live-server.sh
```

Confirm the server answers before opening the UI: `curl -sf http://127.0.0.1:4010/ >/dev/null`. Open **http://127.0.0.1:4010** (same origin as `/api/trask` — do not use Vite :5174 alone without `VITE_TRASK_API_BASE` pointed at 4010).

#### Environment

| Variable | Purpose |
|----------|---------|
| `TRASK_WEB_ALLOW_ANONYMOUS=1` | Anonymous Holocron sessions on standalone `trask-http-server` |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | LLM synthesis for Holocron answers (see `.env`, `.env.local`) |
| `INGEST_STATE_DIR` | Defaults to `data/ingest-worker` for local knowledge chunks |
| `TRASK_WEB_RESEARCH_PYTHON` | Optional; defaults to `.venv-trask-research/bin/python` when present |
| `TRASK_INDEXER_BASE_URL` | Trask indexer retrieve API (default `http://127.0.0.1:8790`) |

`trask-http-server` must use **`persistQueries: true`** for anonymous users so Holocron’s **202 + thread poll** path completes (configured in `apps/trask-http-server/src/main.ts`).

#### Cursor browser MCP vs Playwright

- **Both** are required when validating Holocron changes and browser MCP is available: Playwright (`pnpm holocron:e2e`) **and** all five queries via Cursor browser on `http://127.0.0.1:4010`.
- Do **not** claim “browser works” or Holocron is done after Playwright or CLI only — the user expects explicit confirmation of all five UI queries when MCP is available.
- Lock order: `browser_navigate` (or confirm tab on :4010) → `browser_lock` → interactions → `browser_unlock`.
- Do not treat Vite preview on :4174 with route mocks as validation of live research.
- For public outage recovery, do not stop at localhost or a local static preview; repair the public API origin and re-test the deployed Pages URL.

#### CLI-only (does not satisfy browser requirement)

```bash
pnpm verify:trask-cli
```

Use only when debugging retrieval without the Holocron UI; it does **not** replace `pnpm holocron:e2e`.

#### Offline faithfulness gate (citation alignment)

After code changes to answer formatting, citation alignment, or `grounded-evidence.ts`, run:

```bash
pnpm trask:faithfulness-eval
```

This replays committed golden fixtures under `data/trask-eval/fixtures/` (no live web research). It does **not** replace Holocron e2e for end-to-end research validation.
