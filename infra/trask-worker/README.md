# Trask Cloudflare Worker

Edge proxy for public Holocron (`qa-webui`) → live `trask-http-server`.

## Modes

- **Proxy mode** (`TRASK_BUILTIN_API=0`, required for research): forwards `/api/trask/*` to `TRASK_RESEARCHWIZARD_BASE_URL` (for example Hugging Face Space `OpenKotOR/holocron-trask-http`).
- **Builtin stub** (`TRASK_BUILTIN_API=1`): health checks only; `/api/trask/*` returns **503** (bundled reference Q&A was removed).

There is **no** bundled fallback when upstream fails (`TRASK_BUILTIN_FALLBACK=0` by default).

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

## Variables

| Variable | Purpose |
|----------|---------|
| `TRASK_WEB_ALLOW_ANONYMOUS` | `1` for public Holocron without API key |
| `TRASK_BUILTIN_API` | `0` (required) to proxy live Trask HTTP |
| `TRASK_RESEARCHWIZARD_BASE_URL` | Full `trask-http-server` origin when `TRASK_BUILTIN_API=0` |
| `TRASK_BUILTIN_FALLBACK` | `0` — do not serve offline reference answers on upstream errors |
| `TRASK_WEB_API_KEY` | Optional API key for locked-down deployments |

Public Holocron: point `TRASK_API_BASE` at this worker with `TRASK_BUILTIN_API=0` and a working Trask HTTP upstream.
