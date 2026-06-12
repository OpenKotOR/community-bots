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
- `thread` → `GET /api/trask/thread/:id`
- `history` → `GET /api/trask/history`
- `sources` → `GET /api/trask/sources`
- `session` → `GET /api/trask/session`
- `health` → `GET /healthz`
- `capabilities` → command registry

Research commands require `TRASK_RESEARCHWIZARD_BASE_URL` to point at a healthy `trask-http-server`. Without it, the agent still deploys and exposes capabilities, but `ask` returns an upstream configuration error.

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
pnpm dlx wrangler@4.92.0 dev --config infra/trask-worker/wrangler.toml \
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
```

## Variables

| Variable | Purpose |
|----------|---------|
| `TRASK_WEB_ALLOW_ANONYMOUS` | `1` for public Holocron without API key |
| `TRASK_BUILTIN_API` | `0` (required) to proxy live Trask HTTP |
| `TRASK_RESEARCHWIZARD_BASE_URL` | Full `trask-http-server` origin when `TRASK_BUILTIN_API=0` |
| `TRASK_BUILTIN_FALLBACK` | `0` — do not serve offline reference answers on upstream errors |
| `TRASK_WEB_API_KEY` | Optional API key for locked-down deployments |

Public Holocron: point `TRASK_API_BASE` at this worker with `TRASK_BUILTIN_API=0` and a working Trask HTTP upstream.

Live deploy requires exported Cloudflare credentials:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
pnpm --dir infra/trask-worker run build
pnpm dlx wrangler@4.87.0 deploy --config infra/trask-worker/wrangler.toml \
  --var "TRASK_WEB_ALLOW_ANONYMOUS:1" \
  --var "TRASK_BUILTIN_API:0" \
  --var "TRASK_BUILTIN_FALLBACK:0" \
  --var "TRASK_RESEARCHWIZARD_BASE_URL:https://your-trask-http-origin.example"
```
