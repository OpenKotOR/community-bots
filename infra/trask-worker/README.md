# Trask Q&A Cloudflare Worker

This Worker serves Trask Q&A remotely on Cloudflare Workers (workers.dev free tier). It is intended to back both:

- Discord `/ask` flows via a remote Trask HTTP origin
- Holocron static Pages UI at `https://openkotor.github.io/community-bots/qa-webui/`

## Runtime behavior

- Handles `POST /api/trask/ask`
- Handles CORS preflight (`OPTIONS`)
- Exposes `GET /healthz`
- Proxies requests to `TRASK_RESEARCHWIZARD_BASE_URL/api/trask/ask`
- Optional client auth gate via `TRASK_WEB_API_KEY`
- Anonymous mode via `TRASK_WEB_ALLOW_ANONYMOUS=1`

## Files

- Entrypoint: `infra/trask-worker/src/worker.ts`
- Wrangler config: `infra/trask-worker/wrangler.toml`
- CI deploy workflow: `.github/workflows/trask-worker.yml`

## Local build check

```powershell
pnpm --dir infra/trask-worker run build
pnpm dlx wrangler deploy --config infra/trask-worker/wrangler.toml --dry-run
```

## GitHub Actions deploy (remote)

Workflow: `.github/workflows/trask-worker.yml`

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Required repository variable:

- `TRASK_RESEARCHWIZARD_BASE_URL` (origin only, no trailing slash required)

Optional repository secrets:

- `TRASK_RESEARCHWIZARD_API_KEY` (set as Worker secret if present)
- `TRASK_WEB_API_KEY` (set as Worker secret if present)

Optional repository variable:

- `TRASK_WEB_ALLOW_ANONYMOUS` (defaults to `1` in CI deploy)

## Pages integration

The Pages build workflow (`.github/workflows/deploy-pazaakworld.yml`) now sets:

- `VITE_TRASK_API_BASE` from repository variable `TRASK_API_BASE`, or
- falls back to `https://trask-worker.workers.dev`

This keeps `qa-webui` remote-only and avoids localhost coupling.
