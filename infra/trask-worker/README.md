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
- `capabilities` → command registry

Research commands require `TRASK_RESEARCHWIZARD_BASE_URL` to point at a healthy `trask-http-server`. Without it, the agent still deploys and exposes capabilities, but `ask` returns an upstream configuration error.
Evidence commands require `TRASK_RETRIEVE_BASE_URL` to point at the Cloudflare retrieve Worker (local default `http://127.0.0.1:8787`), preserving the production retrieve boundary instead of pointing agents at raw Chroma/indexer hosts.
The GitHub deploy workflow intentionally skips proxy-mode deploys when this value is unset, local, or a placeholder, so agent `evidence` and `refresh-dry-run` commands cannot accidentally ship against `127.0.0.1`.

## Modes

- **Proxy mode** (`TRASK_BUILTIN_API=0`, required for research): forwards `/api/trask/*` to `TRASK_RESEARCHWIZARD_BASE_URL` (for example Hugging Face Space `OpenKotOR/holocron-trask-http`).
- **Builtin stub** (`TRASK_BUILTIN_API=1`): health checks only; `/api/trask/*` returns **503** (bundled reference Q&A was removed).

When `TRASK_BUILTIN_FALLBACK=1`, upstream **5xx** responses fall back to the builtin stub (still **503** for research — bundled Q&A was removed). `/healthz` probes upstream and returns **503** with `ok: false` when the Trask HTTP host is down (for example HF Space `OpenKotOR/holocron-trask-http` in **ERROR**).

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
| `TRASK_BUILTIN_FALLBACK` | `0` — do not serve offline reference answers on upstream errors |
| `TRASK_WEB_API_KEY` | Optional API key for locked-down deployments |

Public Holocron: point `TRASK_API_BASE` at this worker with `TRASK_BUILTIN_API=0` and a working Trask HTTP upstream.

Live deploy requires exported Cloudflare credentials:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
pnpm --dir infra/trask-worker run build
pnpm dlx wrangler@4.100.0 deploy --config infra/trask-worker/wrangler.toml \
  --var "TRASK_WEB_ALLOW_ANONYMOUS:1" \
  --var "TRASK_BUILTIN_API:0" \
  --var "TRASK_BUILTIN_FALLBACK:0" \
  --var "TRASK_RETRIEVE_BASE_URL:https://trask-retrieve.example.workers.dev" \
  --var "TRASK_RESEARCHWIZARD_BASE_URL:https://your-trask-http-origin.example"
```

For GitHub Actions deploys, configure repository variables:

- `TRASK_BUILTIN_API=0`
- `TRASK_BUILTIN_FALLBACK=0`
- `TRASK_WEB_ALLOW_ANONYMOUS=1` unless the public Worker is API-key protected
- `TRASK_RESEARCHWIZARD_BASE_URL=https://<live-trask-http-origin>`
- `TRASK_RETRIEVE_BASE_URL=https://<public-trask-retrieve-worker-origin>`

Optional repository secrets:

- `TRASK_RESEARCHWIZARD_API_KEY`
- `TRASK_WEB_API_KEY`

Verification:

```bash
pnpm --dir infra/trask-worker run test
pnpm dlx wrangler@4.100.0 deploy --dry-run --config infra/trask-worker/wrangler.toml
```
