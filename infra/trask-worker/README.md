# Trask Cloudflare Worker

Edge proxy and Cloudflare Agents SDK surface for public Holocron (`qa-webui`) → live `trask-http-server`.

## Agents SDK surface

The Worker exports `TraskAgent`, backed by a SQLite Durable Object via the Agents SDK.

Routes:

- `/agents/trask-agent/default` — direct Agents SDK instance route
- `/agents/trask-agent/default/capabilities` — command registry
- `/agents/trask-agent/default/status` — persisted command state
- `/agents/trask-agent/default/query` — `POST { "query": "..." }`
- `/agents/trask-agent/default/command` — `POST { "command": "ask", "args": { ... } }`
- `/api/agent/*` — convenience aliases for the same default instance

Callable RPC methods on `TraskAgent`:

- `capabilities()` — command registry, callable methods, provider order, safety limits
- `status()` — persisted command state plus capabilities
- `query(input)` / `ask(input)` / `research(input)` — submit a Trask research query
- `models()` / `sources()` / `session()` / `health()` — read-only Trask capability checks
- `thread(input)` / `history(input)` — read persisted Trask query/thread state
- `cancel(input)` — cancel a pending query
- `evidence(input)` — query the Cloudflare retrieve Worker boundary
- `refreshDryRun(input)` — token-guarded dry-run reindex request through the retrieve/indexer boundary
- `purgeDiscordMessage(input)` — safe dry-run purge plan only
- `invitePolicy()` / `configureInvite(input)` / `allowInviteGuild(input)` / `revokeInviteGuild(input)` — persistent Trask Discord install policy
- `command(name, args)` — generic registry-backed command entrypoint

Commands exposed by the agent:

- `ask` / `query` / `research` → `POST /api/trask/ask`
- `models` → `GET /api/trask/models`
- `thread` → `GET /api/trask/thread/:id`
- `cancel` → `POST /api/trask/query/:id/cancel`
- `history` → `GET /api/trask/history`
- `sources` → `GET /api/trask/sources`
- `session` → `GET /api/trask/session`
- `health` → `GET /healthz`
- `evidence` → `POST $TRASK_RETRIEVE_BASE_URL/retrieve`
- `refresh-dry-run` → `POST $TRASK_RETRIEVE_BASE_URL/reindex` with `TRASK_REINDEX_TOKEN`
- `purge-discord-message` → safe dry-run request planning only
- `invite-policy` → `GET /api/trask/install-policy`
- `configure-invite` → `POST /api/trask/install-policy/configure`
- `allow-invite-guild` / `revoke-invite-guild` → persistent install allowlist mutation
- `capabilities` → command registry

Public Trask install broker:

- `/api/trask/invite?guild_id=<discord-guild-id>` redirects to Discord OAuth only when the guild is allowlisted.
- `/api/trask/install-policy` exposes the merged env + persistent guild allowlist for bot refresh.
- `/api/trask/install-policy/configure`, `/allow`, and `/revoke` update persistent state without restarting the Worker or Trask bot. First-time `/configure` can set a persistent `adminToken`; later HTTP mutations require that token in `Authorization: Bearer ...` or an optional bootstrap env token.
- Env vars are optional bootstrap defaults. Runtime policy lives in the Agent Durable Object state once configured through the API.

Research commands require `TRASK_RESEARCHWIZARD_BASE_URL` to point at a healthy `trask-http-server`. Without it, the agent still deploys and exposes capabilities, but `ask` returns an upstream configuration error.
Evidence commands require `TRASK_RETRIEVE_BASE_URL` to point at the Cloudflare retrieve Worker (local default `http://127.0.0.1:8787`), preserving the production retrieve boundary instead of pointing agents at raw Chroma/indexer hosts.
The GitHub deploy workflow intentionally skips proxy-mode deploys when this value is unset, local, or a placeholder, so agent `evidence` and `refresh-dry-run` commands cannot accidentally ship against `127.0.0.1`.

## Modes

- **Proxy mode** (`TRASK_BUILTIN_API=0`, required for research): forwards `/api/trask/*` to `TRASK_RESEARCHWIZARD_BASE_URL` (for example Hugging Face Space `OpenKotOR/holocron-trask-http`).
- **Builtin stub** (`TRASK_BUILTIN_API=1`): health checks only; `/api/trask/*` returns **503** (bundled reference Q&A was removed).

Upstream **5xx**, timeout, and rate-limit responses fall back to the builtin stub by default (still **503** for research — bundled Q&A was removed). `/healthz` reports `mode: "degraded-builtin"` with `ok: true` when the live Trask HTTP host is down but the Worker can still answer health and install-policy traffic. Set `TRASK_BUILTIN_FALLBACK=0` only when you want upstream failures to fail the Worker health check.

## Layout

- Worker entry: `src/worker.ts`
- Deprecated stub: `src/builtin-trask-api.ts`
- Live Trask HTTP deploy: `infra/trask-http-public/`

## Local dev

```bash
pnpm dlx wrangler@4.100.0 dev --config infra/trask-worker/wrangler.toml \
  --var "TRASK_WEB_ALLOW_ANONYMOUS:1" \
  --var "TRASK_BUILTIN_API:0" \
  --var "TRASK_RESEARCHWIZARD_BASE_URL:http://127.0.0.1:4010"
```

Local capability check:

```bash
curl -sS http://127.0.0.1:8787/api/agent/capabilities | jq .
curl -sS -X POST http://127.0.0.1:8787/api/agent/query \
  -H 'Content-Type: application/json' \
  --data '{"query":"What is TSLPatcher?"}' | jq .
curl -sS -X POST http://127.0.0.1:8787/api/agent/command \
  -H 'Content-Type: application/json' \
  --data '{"command":"evidence","args":{"query":"What is TSLPatcher?","limit":5}}' | jq .
```

## Variables

| Variable | Purpose |
|----------|---------|
| `TRASK_WEB_ALLOW_ANONYMOUS` | `1` for public Holocron without API key |
| `TRASK_BUILTIN_API` | `0` (required) to proxy live Trask HTTP |
| `TRASK_RESEARCHWIZARD_BASE_URL` | Full `trask-http-server` origin when `TRASK_BUILTIN_API=0` |
| `TRASK_RETRIEVE_BASE_URL` | Cloudflare retrieve Worker origin for `evidence` and dry-run reindex commands |
| `TRASK_REINDEX_TOKEN` | Optional token for `refresh-dry-run`; without it the command reports the planned request and does not call upstream |
| `TRASK_BUILTIN_FALLBACK` | Optional; defaults to `1` so upstream failures degrade fast instead of hanging Worker health |
| `TRASK_WEB_API_KEY` | Optional API key for locked-down deployments |
| `TRASK_DISCORD_APP_ID` | Optional bootstrap Discord application id for brokered Trask installs; API-configured state wins |
| `TRASK_DISCORD_INVITE_PERMISSIONS` | Optional bootstrap Trask OAuth permission integer (default `84992`); API-configured state wins |
| `TRASK_INVITE_ALLOWED_GUILD_IDS` | Optional comma-separated bootstrap install allowlist; API-configured state is merged |
| `TRASK_INVITE_ADMIN_TOKEN` | Optional bootstrap secret for live install-policy updates; persistent `/configure` token is preferred |

Public Holocron: point `TRASK_API_BASE` at this worker with `TRASK_BUILTIN_API=0` and a working Trask HTTP upstream.

Live deploy requires exported Cloudflare credentials:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
pnpm --dir infra/trask-worker run build
pnpm dlx wrangler@4.100.0 deploy --config infra/trask-worker/wrangler.toml \
  --var "TRASK_WEB_ALLOW_ANONYMOUS:1" \
  --var "TRASK_BUILTIN_API:0" \
  --var "TRASK_BUILTIN_FALLBACK:1" \
  --var "TRASK_RETRIEVE_BASE_URL:https://trask-retrieve.example.workers.dev" \
  --var "TRASK_RESEARCHWIZARD_BASE_URL:https://your-trask-http-origin.example"
```

For GitHub Actions deploys, configure repository variables:

- `TRASK_BUILTIN_API=0`
- `TRASK_BUILTIN_FALLBACK=1` is the default; set `0` only for strict upstream-required health
- `TRASK_WEB_ALLOW_ANONYMOUS=1` unless the public Worker is API-key protected
- `TRASK_RESEARCHWIZARD_BASE_URL=https://<live-trask-http-origin>`
- `TRASK_RETRIEVE_BASE_URL=https://<public-trask-retrieve-worker-origin>`
- `TRASK_DISCORD_APP_ID=<Trask Discord application id>`
- `TRASK_INVITE_ALLOWED_GUILD_IDS=<optional bootstrap guild ids>`

Optional repository secrets:

- `TRASK_RESEARCHWIZARD_API_KEY`
- `TRASK_WEB_API_KEY`
- `TRASK_INVITE_ADMIN_TOKEN` (bootstrap only; not required when configured through the API)

Verification:

```bash
pnpm --dir infra/trask-worker run test
pnpm dlx wrangler@4.100.0 deploy --dry-run --config infra/trask-worker/wrangler.toml
```
