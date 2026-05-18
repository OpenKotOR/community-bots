## Learned User Preferences

- Do not install, enable, or recommend the **Runlayer** Cursor marketplace plugin (MCP governance hooks block browser/MCP tools without tenant login).
- Prefer taking full initiative: run commands, start services, and verify behavior in this environment instead of telling the user to perform manual setup or testing steps themselves.
- For repo-wide TypeScript tightening (replacing `any` or unjustified `unknown`), leave `./vendor/ai-researchwizard` out of scope unless the user explicitly includes it.

## Learned Workspace Facts

- **PazaakWorld gameplay** (authoritative matches, RPCs, realtime): local/dev uses **Nakama** (`infra/nakama`, `@openkotor/pazaak-nakama` runtime). Point the client with `VITE_PAZAAK_BACKEND=nakama` (or set `VITE_NAKAMA_HOST`) and keep `VITE_LEGACY_HTTP_ORIGIN=http://localhost:4001` when you still need the bot for OAuth token exchange and `/api/trask/*`. Older Cloudflare Worker + Durable Object paths remain in-repo for reference but are not the primary gameplay backend for the Nakama cutover.
- **PazaakWorld HTTP API failover** (non-Nakama paths): `@openkotor/platform` `createBrowserApiClient` walks comma-separated `VITE_API_BASES` in order and retries the next origin on **network errors or 5xx** (4xx does not hop). **`VITE_LEGACY_HTTP_ORIGIN`** origins are **prepended** (deduped) before `VITE_API_BASES`, so Pages can set `VITE_LEGACY_HTTP_ORIGIN` to a public bot and `PAZAAK_API_BASES` to a Cloudflare Worker URL for bot-first → Worker fallback. Worker lives in `infra/pazaak-matchmaking-worker`; CI runs `wrangler deploy --dry-run` in `.github/workflows/pazaak-matchmaking-worker.yml` without secrets; live deploy needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets.
- **PazaakWorld on GitHub Pages** (static client only): `OpenKotOR/community-bots` is published at `https://openkotor.github.io/community-bots/`; CI and Vite should use `BASE=/community-bots/` (and `import.meta.env.BASE_URL` in app code). Treat legacy `/bots/` org URLs as mismatched with the renamed repo unless a separate redirect or `bots` Pages repo exists.
- For KotOR-authentic color theming in PazaakWorld (including fixing mismatched labels like “KotOR classic”), reference OpenKotOR ModSync’s K1 and TSL theme definitions rather than inventing standalone palettes.
- **Trask Q&A:** Node side uses `@openkotor/trask` and `@openkotor/trask-http`; `apps/trask-http-server` can serve `apps/holocron-web` and expose `/api/trask/*`, including a minimal in-memory `/__spark-kv` shim for static Holocron builds. Research calls go to `vendor/ai-researchwizard` (GPTR). When `TRASK_GPT_RESEARCHER_PYTHON` is unset, `loadResearchWizardRuntimeConfig` prefers the monorepo bootstrap interpreter at `.venv-trask-gptr` (`Scripts/python.exe` on Windows, `bin/python` on Unix), matching `scripts/smoke_trask_headless_gptr.py`. The vendored `vendor/ai-researchwizard/requirements.txt` omits `langchain-netmind` by default (LangChain version pin conflict); install it with `pip install langchain-netmind --no-deps` only if you need it. Python LLM fallback ordering comes from `vendor/llm_fallbacks` (`FREE_CHAT_MODELS` / `get_fallback_list("chat")`, not a `FREE_LLM_MODELS` env var). `loadSharedAiConfig` may fall back to `OPENROUTER_API_KEY` when `OPENAI_API_KEY` is unset for OpenAI-compatible clients (optional `OPENAI_BASE_URL` and OpenRouter headers). Holocron browser sessions allow anonymous `/api/trask/*` when `TRASK_WEB_API_KEY` is unset unless `TRASK_WEB_ALLOW_ANONYMOUS=0`; set `TRASK_WEB_API_KEY` for locked-down deployments. `TRASK_RESEARCHWIZARD_TIMEOUT_MS` defaults to **900000** ms when unset (`loadResearchWizardRuntimeConfig` in `packages/config`). **Public Holocron (Pages):** set repository variable `TRASK_API_BASE` to the deployed Trask worker URL with `TRASK_BUILTIN_API=1` on the worker (bundled technical-reference API in `infra/trask-worker` / `infra/holocron-trask-api`). CI deploys the worker via `.github/workflows/trask-worker.yml` and optionally mirrors the same fallback to Hugging Face Space `OpenKotOR/holocron-trask-api` via `.github/workflows/holocron-trask-api.yml` when `HUGGINGFACE_TOKEN` is set. For full live GPTR research on a public origin, set `TRASK_BUILTIN_API=0` and point `TRASK_RESEARCHWIZARD_BASE_URL` at a real `trask-http-server` host instead.

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
2. Run the **full** Playwright suite (all five searches — not a subset):

```bash
pnpm exec playwright install chromium --with-deps   # once per machine
pnpm holocron:e2e
# server already listening:
HOLOCRON_REUSE_SERVER=1 pnpm holocron:e2e
```

3. When the Cursor browser tool works, spot-check at least one query on **http://127.0.0.1:4010/?thread=<fresh-uuid>** so the browser does not reuse an old Holocron conversation. Use the same steps as the spec: enabled **Question input** → submit → **Thinking** clears → answer + visible citations/source badges (`https://…` or local `local://technical-reference/...` citations both count when they are rendered in the Sources UI).
4. If the task touches deployed/public Holocron behavior, also verify **`https://openkotor.github.io/community-bots/qa-webui/?thread=<fresh-uuid>`** in a real browser after deploy. Agents must keep `TRASK_API_BASE` pointed at the repo-managed worker (or redeployed HF mirror from `infra/holocron-trask-api`), set `TRASK_BUILTIN_API=1` on the worker unless intentionally using full GPTR upstream, trigger the Pages rebuild themselves, and confirm at least one live public query completes with grounded sources before reporting success.

**Pass criteria (each of the five queries):** question input enabled → submit → user message visible → assistant answer substantive and on-topic → no stuck **Thinking** (≤ ~200s) → **Sources** panel, numbered citation links, or visible grounded source references (including `local://technical-reference/...` when rendered in the UI).

**Canonical five queries** (defined in `holocron-research.spec.ts`):

1. What is TSLPatcher used for in KOTOR modding?
2. How do I troubleshoot KOTOR widescreen resolution issues on PC?
3. What is MDLOps used for in the KOTOR toolchain?
4. Where are Knights of the Old Republic save files stored on Windows?
5. What does the reone project provide for Odyssey engine work?

#### Start stack (agents run this themselves)

```bash
node scripts/holocron-e2e-live-build.mjs
TRASK_WEB_ALLOW_ANONYMOUS=1 bash scripts/holocron-e2e-live-server.sh
```

Open **http://127.0.0.1:4010** (same origin as `/api/trask` — do not use Vite :5174 alone without `VITE_TRASK_API_BASE` pointed at 4010).

#### Environment

| Variable | Purpose |
|----------|---------|
| `TRASK_WEB_ALLOW_ANONYMOUS=1` | Anonymous Holocron sessions on standalone `trask-http-server` |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | GPTR + answer rewrite (see `.env`, `.env.local`, `vendor/ai-researchwizard/.env`) |
| `INGEST_STATE_DIR` | Defaults to `data/ingest-worker` for local knowledge chunks |
| `TRASK_GPT_RESEARCHER_PYTHON` | Optional; defaults to `.venv-trask-gptr/bin/python` when present |

`trask-http-server` must use **`persistQueries: true`** for anonymous users so Holocron’s **202 + thread poll** path completes (configured in `apps/trask-http-server/src/main.ts`).

#### Cursor browser MCP vs Playwright

- **Playwright** (`pnpm holocron:e2e`) is always required when validating Holocron changes; it drives Chromium through the same UI flow as a user.
- **Cursor browser** is encouraged for spot-checks when the IDE browser MCP is available.
- Do not treat Vite preview on :4174 with route mocks as validation of live research.
- For public outage recovery, do not stop at localhost or a local static preview; repair the public API origin and re-test the deployed Pages URL.

#### CLI-only (does not satisfy browser requirement)

```bash
pnpm verify:trask-cli
```

Use only when debugging GPTR/retrieval without the Holocron UI; it does **not** replace `pnpm holocron:e2e`.
