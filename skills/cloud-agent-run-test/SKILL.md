---
name: cloud-agent-run-test
description: Run, configure, and test the OpenKotor Discord bots monorepo in Cloud Agent environments — install, build, dev servers, env vars, and area-specific test workflows.
---

# Cloud agent: run and test this codebase

Use this skill when you need to **bootstrap**, **run apps**, or **verify changes** in Cursor Cloud (or any headless agent) against this repo. Prefer **running commands** over guessing paths.

## First boot (every clean workspace)

1. **Toolchain**: Node **≥24**, **pnpm 10.11.0** (enable with `corepack enable` then `corepack prepare pnpm@10.11.0 --activate` if needed).
2. **Install**: From repo root: `pnpm install`.
3. **esbuild binary** (required for `@openkotor/pazaak-nakama` bundle): `pnpm rebuild esbuild` once per clean install (`onlyBuiltDependencies` blocks the default postinstall).
4. **Compile**: `pnpm build` (workspace `tsc -b`).
5. **Quick gates**: `pnpm check` (typecheck only); lint is **pazaak-world only**: `pnpm --filter pazaak-world lint`.

**Unit tests (Node built-in):** after a successful build:

```bash
node --test packages/*/dist/*.test.js apps/*/dist/*.test.js
```

Package manager is **pnpm**; root `package-lock.json` is legacy—ignore it.

---

## By area

### 1. Workspace-wide (TypeScript packages + apps)

| Goal | Command |
|------|---------|
| Full compile | `pnpm build` |
| Typecheck | `pnpm check` |
| Unit tests | `node --test packages/*/dist/*.test.js apps/*/dist/*.test.js` (after `pnpm build`) |

**Workflow:** `pnpm install` → `pnpm rebuild esbuild` → `pnpm build` → `pnpm check` → `node --test …`. For TS-only edits, `pnpm check` may suffice before a focused test run.

**Scope note:** repo-wide tightening of `any` / `unknown` should exclude `./vendor/ai-researchwizard` unless the task explicitly includes it.

---

### 2. `apps/pazaak-world` (Vite SPA, Playwright e2e)

| Goal | Command |
|------|---------|
| Dev server | `pnpm dev:pazaak-world` (default **http://127.0.0.1:5173**) |
| Lint | `pnpm --filter pazaak-world lint` |
| Production build | `pnpm --filter pazaak-world build` |
| E2E | `pnpm --filter pazaak-world test:e2e` (starts Vite via Playwright config; needs Nakama for backend-dependent specs—see Nakama section) |

**“Feature flags” (Vite `import.meta.env`):** copy or extend `apps/pazaak-world/.env.example`. Common toggles:

- **`VITE_PAZAAK_BACKEND`** — set to `nakama` for Nakama-backed dev/e2e (Playwright sets this in `playwright.config.ts`).
- **`VITE_NAKAMA_HOST` / `VITE_NAKAMA_PORT` / `VITE_NAKAMA_SERVER_KEY` / `VITE_NAKAMA_USE_SSL`** — client Nakama connection (defaults align with local Docker compose).
- **`VITE_LEGACY_HTTP_ORIGIN`** — e.g. `http://localhost:4001` when you need the legacy HTTP bot for OAuth token exchange and `/api/trask/*` alongside Nakama.
- **`VITE_API_BASES`** — comma-separated REST API origins; empty is valid for offline/local practice UI paths.
- **`VITE_DISCORD_CLIENT_ID`** — required for Embedded App OAuth; omit only when not testing Discord flows.

**Agent gotcha:** without a reachable backend (bot HTTP or Nakama), the main menu may show mostly background—**expected** if APIs are down.

**E2E workflow:** start Nakama stack if tests need realtime backend → `pnpm --filter pazaak-world test:e2e`. Override UI URL with `PLAYWRIGHT_BASE_URL` if needed.

---

### 3. `apps/holocron-web` (Vite, Trask UI)

| Goal | Command |
|------|---------|
| Dev | `pnpm dev:holocron-web` (port **5174** if 5173 is taken) |
| Production build | `pnpm --filter @openkotor/holocron-web build` |
| Root “e2e” smoke (build only) | `pnpm holocron:e2e` |

**Env (Vite):**

- **`VITE_TRASK_API_BASE`** — Trask HTTP API origin (e.g. `http://127.0.0.1:4010` when `trask-http-server` is up).
- **`VITE_TRASK_API_KEY`** — must match server `TRASK_WEB_API_KEY` when the server requires a key.
- **`VITE_TRASK_LEGACY_SPARK=1`** — legacy Spark mode toggle used in `App.tsx`.

**Workflow (browser + API):** terminal A: `TRASK_WEB_ALLOW_ANONYMOUS=1 pnpm dev:trask-http` (or set `TRASK_WEB_API_KEY` and matching `VITE_TRASK_API_KEY`). Build or dev Holocron with `VITE_TRASK_API_BASE` pointing at that origin. Exercise Q&A flows in the browser.

---

### 4. `apps/trask-http-server` + `packages/trask` / `packages/trask-http`

| Goal | Command |
|------|---------|
| Dev API + static Holocron (if `apps/holocron-web/dist` exists) | `pnpm dev:trask-http` |
| Package tests | `pnpm build` then `node --test packages/trask/dist/*.test.js packages/trask-http/dist/*.test.js` |

**Auth / “login” for local HTTP API:** there is no interactive login in minimal mode. Use either:

- **`TRASK_WEB_ALLOW_ANONYMOUS=1`** — accepts unauthenticated requests (dev only), or  
- **`TRASK_WEB_API_KEY=<secret>`** — require `Authorization: Bearer <secret>` or `X-Trask-Api-Key: <secret>` on `/api/trask/*`.

**Other useful env** (from `loadTraskHttpServerConfig`): `TRASK_HTTP_PORT` (default **4010**), `TRASK_HTTP_DATA_DIR`, `TRASK_PUBLIC_WEB_ORIGIN` (CORS), `TRASK_WEBUI_DIST_PATH` (override path to built Holocron), `INGEST_STATE_DIR` / chunk dir for retrieval. AI/research keys follow shared `loadSharedAiConfig` (see `packages/config`); without keys, some routes may fail—mock or skip those tests.

**Known flake:** `packages/trask-http` has **two** tests that can fail intermittently on `/tmp` rename races; treat failures there as possibly pre-existing unless you touched that code.

**Workflow:** `TRASK_WEB_ALLOW_ANONYMOUS=1 pnpm dev:trask-http` → `curl` or Holocron against `http://127.0.0.1:4010/api/trask/...` → run package `node --test` after edits.

---

### 5. `apps/hk86-web` (static hub)

| Goal | Command |
|------|---------|
| Dev | `pnpm dev:hk86-web` |
| E2E | `pnpm test:hk86-web` (runs **build** then Playwright) |

**Env:** set `VITE_HK_DISCORD_APPLICATION_ID` (and related `VITE_*_DISCORD_APPLICATION_ID` / repo URLs) at **build** time; invite anchors may be skipped in e2e if IDs are missing (see `hub-smoke.spec.ts`).

---

### 6. Discord bots (`apps/pazaak-bot`, `apps/trask-bot`, `apps/hk-bot`)

| Goal | Command |
|------|---------|
| Run bot (needs token) | `pnpm dev:pazaak` / `pnpm dev:trask` / `pnpm dev:hk` |

**Env:** each bot expects its Discord token (e.g. `PAZAAK_DISCORD_BOT_TOKEN`, `TRASK_DISCORD_BOT_TOKEN`, `HK_DISCORD_BOT_TOKEN`). Cloud agents usually **cannot** complete real Discord login; validate with **unit tests** under `apps/hk-bot` and **smoke scripts** instead.

**Workflow:** `pnpm build` → `node --test apps/hk-bot/dist/*.test.js` (and other packages). Optional: `pnpm discord:smoke-trask-commands` (script; may need Discord credentials).

---

### 7. `infra/nakama` + `apps/pazaak-nakama`

| Goal | Command |
|------|---------|
| Build Go runtime bundle | `pnpm build:pazaak-nakama` or `pnpm --filter @openkotor/pazaak-nakama build` |
| Nakama + Postgres | `pnpm dev:pazaak-nakama` (build + `docker compose -f infra/nakama/docker-compose.yml up`) |

**Ports:** Nakama client API **7350** (see `infra/nakama/docker-compose.yml`). Align `VITE_NAKAMA_*` in pazaak-world with this stack.

**Workflow:** start compose → set client env to Nakama → `pnpm dev:pazaak-world` or Playwright e2e.

---

### 8. `apps/ingest-worker`

| Goal | Command |
|------|---------|
| Dev | `pnpm dev:ingest` |

Uses `dotenv` and `@openkotor/config`—check package README or `src/main.ts` for required env (Firecrawl, paths). **Workflow:** configure `.env` locally → `pnpm dev:ingest`; no standard workspace-wide test runner beyond `pnpm build` + manual run.

---

### 9. Root scripts (smokes / checks)

| Script | Purpose |
|--------|---------|
| `pnpm check:pazaak-oauth` | OAuth readiness check for Pazaak |
| `pnpm smoke:trask-gptr-dry` | Headless Trask/GPTR smoke (**dry-run**) |
| `pnpm smoke:trask-gptr` | Same without dry-run (needs Python + credentials) |

---

## Updating this skill

When you discover a new **command**, **env var**, **port**, **flake**, or **runbook step**:

1. Edit **`skills/cloud-agent-run-test/SKILL.md`** in the matching **By area** section (or add a subsection).
2. Keep tables **copy-pasteable** (exact script names from root `package.json` or package `package.json`).
3. If the knowledge belongs in long-term **repo policy** (preferences, gotchas), also add a short bullet to **`AGENTS.md`** and keep this skill as the **operational** quick reference.
4. After CI or local verification, commit with a message like `docs(skill): note <topic> for cloud agents`.

---

## Related docs

- **`AGENTS.md`** — stack facts, Trask/Nakama notes, flaky test callout, holocron TS version split.
