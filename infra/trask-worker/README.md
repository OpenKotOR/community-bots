# Trask Q&A Cloudflare Worker

This Worker exposes the `/api/trask/ask` endpoint for the Trask Discord Q&A bot and Holocron web UI, running entirely on Cloudflare Workers.

## Features
- Stateless /ask endpoint for Discord and web clients
- Calls out to the ResearchWizard backend (Python) for research
- Supports API key and anonymous access (configurable)

## Deployment
- Configure secrets in Cloudflare dashboard or GitHub Actions
- Deploy with `wrangler deploy --config infra/trask-worker/wrangler.toml`
- See wrangler.toml for environment variable bindings

## Development
- Worker entrypoint: `src/worker.ts`
- Build with `pnpm build:trask-worker`
- Test with `wrangler dev --config infra/trask-worker/wrangler.toml`

## CI
- Add a GitHub Actions workflow to automate deploys on push

## TODO
- Port all /api/trask/* endpoints
- Remove Node/Express dependencies
- Harden error handling and logging
- Add Durable Object or KV for persistent storage if needed
