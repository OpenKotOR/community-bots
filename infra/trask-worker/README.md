# Trask Q&A Cloudflare Worker

This Worker serves Trask Q&A remotely on Cloudflare Workers (workers.dev free tier). It is intended to back both:

- Discord `/ask` flows via a remote Trask HTTP origin
- Holocron static Pages UI at `https://openkotor.github.io/community-bots/qa-webui/`

## Runtime behavior

- Proxies `/api/trask/*` to the upstream Trask HTTP origin at `TRASK_RESEARCHWIZARD_BASE_URL`
- Supports the Holocron browser contract (`/session`, `/history`, `/thread/:threadId`, `/ask`, `/query/:queryId/cancel`, etc.)
- Handles CORS preflight (`OPTIONS`)
- Exposes `GET /healthz`
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

## Local dev check

Point the worker at a real Trask HTTP origin that already serves `/api/trask/*` (for example `trask-http-server` on `:4010`):

```powershell
pnpm dlx wrangler@4.92.0 dev --config infra/trask-worker/wrangler.toml --var "TRASK_WEB_ALLOW_ANONYMOUS:1" --var "TRASK_RESEARCHWIZARD_BASE_URL:http://127.0.0.1:4010"
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

- `VITE_TRASK_API_BASE` from repository variable `TRASK_API_BASE`
- fails the Holocron Pages build when `TRASK_API_BASE` is unset instead of publishing a broken API origin

This keeps `qa-webui` remote-only and avoids localhost coupling.

`TRASK_RESEARCHWIZARD_BASE_URL` must be a real upstream that mounts the Trask HTTP router. Placeholder origins like `https://example.com` let `/healthz` succeed but break live Holocron queries.
