## Learned User Preferences

- Do not install, enable, or recommend the **Runlayer** Cursor marketplace plugin (MCP governance hooks block browser/MCP tools without tenant login).
- Prefer taking full initiative: run commands, start services, and verify behavior in this environment instead of telling the user to perform manual setup or testing steps themselves.
- Holocron live research uses **Crawl4AI + DuckDuckGo** (`scripts/trask_web_research.py`) and Node LLM synthesis; bootstrap with `bash scripts/bootstrap_trask_research.sh`.

## Learned Workspace Facts

- **PazaakWorld gameplay** (authoritative matches, RPCs, realtime): local/dev uses **Nakama** (`infra/nakama`, `@openkotor/pazaak-nakama` runtime). Point the client with `VITE_PAZAAK_BACKEND=nakama` (or set `VITE_NAKAMA_HOST`) and keep `VITE_LEGACY_HTTP_ORIGIN=http://localhost:4001` when you still need the bot for OAuth token exchange and `/api/trask/*`. Older Cloudflare Worker + Durable Object paths remain in-repo for reference but are not the primary gameplay backend for the Nakama cutover.
- **PazaakWorld HTTP API failover** (non-Nakama paths): `@openkotor/platform` `createBrowserApiClient` walks comma-separated `VITE_API_BASES` in order and retries the next origin on **network errors or 5xx** (4xx does not hop). **`VITE_LEGACY_HTTP_ORIGIN`** origins are **prepended** (deduped) before `VITE_API_BASES`, so Pages can set `VITE_LEGACY_HTTP_ORIGIN` to a public bot and `PAZAAK_API_BASES` to a Cloudflare Worker URL for bot-first → Worker fallback. Worker lives in `infra/pazaak-matchmaking-worker`; CI runs `wrangler deploy --dry-run` in `.github/workflows/pazaak-matchmaking-worker.yml` without secrets; live deploy needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
- **PazaakWorld on GitHub Pages** (static client only): `OpenKotOR/community-bots` is published at `https://openkotor.github.io/community-bots/`; CI and Vite should use `BASE=/community-bots/` (and `import.meta.env.BASE_URL` in app code). Do not document or default to `/bots/` path prefixes.
- For KotOR-authentic color theming in PazaakWorld (including fixing mismatched labels like “KotOR classic”), reference OpenKotOR ModSync’s K1 and TSL theme definitions rather than inventing standalone palettes.
- **Trask / Holocron:** UI in **`apps/holocron-web`**; API in **`apps/trask-http-server`** (`/api/trask/*`, serves built Holocron on port **4010**). Live research: **`scripts/trask_web_research.py`** (Crawl4AI + DDG) + OpenAI-compatible rewrite in `@openkotor/trask`. Bootstrap: `bash scripts/bootstrap_trask_research.sh`; set `TRASK_WEB_RESEARCH_PYTHON` and `OPENAI_API_KEY` or `OPENROUTER_API_KEY`. `loadSharedAiConfig` may use `OPENROUTER_API_KEY` when `OPENAI_API_KEY` is unset. Holocron allows anonymous `/api/trask/*` when `TRASK_WEB_ALLOW_ANONYMOUS=1`. `TRASK_WEB_RESEARCH_TIMEOUT_MS` defaults to **900000** ms (legacy alias `TRASK_RESEARCHWIZARD_TIMEOUT_MS`).

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

**Requirement:** Do not claim Holocron search/research is working until you have **fully verified it in a real browser** — all five canonical research queries must complete with substantive answers and sources. Use Playwright (`pnpm holocron:e2e`) as the mandatory automated gate.

Holocron e2e is **functional only** (no mocked `/api/trask` routes). The single spec is `apps/holocron-web/e2e/holocron-research.spec.ts`.

#### Mandatory verification (run before “done”)

1. Ensure **`trask-http-server`** serves built Holocron on **http://127.0.0.1:4010** (`TRASK_WEB_ALLOW_ANONYMOUS=1`).
2. Bootstrap research venv: `bash scripts/bootstrap_trask_research.sh`
3. Run the **full** Playwright suite (all five searches):

```bash
pnpm exec playwright install chromium --with-deps # once per machine
node scripts/holocron-e2e-live-build.mjs
TRASK_WEB_ALLOW_ANONYMOUS=1 bash scripts/holocron-e2e-live-server.sh
pnpm holocron:e2e
# server already listening:
HOLOCRON_REUSE_SERVER=1 pnpm holocron:e2e
```

**Pass criteria (each of the five queries):** question input enabled → submit → user message visible → assistant answer substantive and on-topic → no stuck **Thinking** (≤ ~200s) → **Sources** panel or visible `https://` citations (≥2).

| Variable | Purpose |
|----------|---------|
| `TRASK_WEB_ALLOW_ANONYMOUS=1` | Anonymous Holocron on standalone `trask-http-server` |
| `TRASK_WEB_RESEARCH_PYTHON` | Crawl4AI runner (`.venv-trask-research/bin/python`) |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | LLM synthesis for Holocron answers |
