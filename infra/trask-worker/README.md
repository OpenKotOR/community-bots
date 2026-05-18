# Trask Q&A Cloudflare Worker

This Worker serves Trask Q&A remotely on Cloudflare Workers (workers.dev free tier). It is intended to back both:

- Discord `/ask` flows via a remote Trask HTTP origin
- Holocron static Pages UI at `https://openkotor.github.io/community-bots/qa-webui/`

## Runtime behavior

- **Builtin mode** (`TRASK_BUILTIN_API=1`, default in CI): serves bundled technical-reference answers from `src/builtin-trask-api.ts` (same content as `infra/holocron-trask-api/server.mjs`) for `/api/trask/*`, `/reference/*`, and `GET /healthz`.
- **Proxy mode** (`TRASK_BUILTIN_API=0` with a real `TRASK_RESEARCHWIZARD_BASE_URL`): forwards `/api/trask/*` to a full Trask HTTP origin (for example `trask-http-server` with GPTR).
- Handles CORS preflight (`OPTIONS`)
- Optional client auth gate via `TRASK_WEB_API_KEY`
- Anonymous mode via `TRASK_WEB_ALLOW_ANONYMOUS=1`

## Files

- Entrypoint: `infra/trask-worker/src/worker.ts`
- Builtin fallback: `infra/trask-worker/src/builtin-trask-api.ts`
- HF Space mirror (optional): `infra/holocron-trask-api/` (deployed by `.github/workflows/holocron-trask-api.yml`)
- Wrangler config: `infra/trask-worker/wrangler.toml`
- CI deploy workflow: `.github/workflows/trask-worker.yml`

## Local build check

```powershell
pnpm --dir infra/trask-worker run build
pnpm dlx wrangler deploy --config infra/trask-worker/wrangler.toml --dry-run
```

## Local dev check

Builtin Holocron fallback (no upstream Trask HTTP server required):

```powershell
pnpm dlx wrangler@4.92.0 dev --config infra/trask-worker/wrangler.toml --var "TRASK_WEB_ALLOW_ANONYMOUS:1" --var "TRASK_BUILTIN_API:1"
```

Proxy to a local `trask-http-server` on `:4010`:

```powershell
pnpm dlx wrangler@4.92.0 dev --config infra/trask-worker/wrangler.toml --var "TRASK_WEB_ALLOW_ANONYMOUS:1" --var "TRASK_BUILTIN_API:0" --var "TRASK_RESEARCHWIZARD_BASE_URL:http://127.0.0.1:4010"
```

## GitHub Actions deploy (remote)

Workflow: `.github/workflows/trask-worker.yml`

Required repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Recommended repository variables (public Holocron on Pages):

- `TRASK_API_BASE` — worker URL, for example `https://trask-worker.<account>.workers.dev`
- `TRASK_BUILTIN_API` — `1` (default) to use bundled references without an external upstream

Optional repository variables:

- `TRASK_RESEARCHWIZARD_BASE_URL` — full Trask HTTP origin when `TRASK_BUILTIN_API=0`
- `TRASK_WEB_ALLOW_ANONYMOUS` (defaults to `1` in CI deploy)

Optional repository secrets:

- `TRASK_RESEARCHWIZARD_API_KEY` (set as Worker secret if present)
- `TRASK_WEB_API_KEY` (set as Worker secret if present)
- `HUGGINGFACE_TOKEN` — for optional HF Space deploy (`.github/workflows/holocron-trask-api.yml`)

## Pages integration

The Pages build workflow (`.github/workflows/deploy-pazaakworld.yml`) sets:

- `VITE_TRASK_API_BASE` from repository variable `TRASK_API_BASE`
- fails the Holocron Pages build when `TRASK_API_BASE` is unset instead of publishing a broken API origin

Point `TRASK_API_BASE` at this worker when `TRASK_BUILTIN_API=1`. The optional HF Space `OpenKotOR/holocron-trask-api` is a secondary deploy target from the same source tree; it is not required when the worker serves the builtin API.
