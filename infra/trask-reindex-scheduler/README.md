# Trask reindex scheduler (Cloudflare cron)

Weekly refresh of the cached Trask/Holocron corpus (**REQ-A**). A Cloudflare cron
trigger fires `scheduled()` every **Monday 06:00 UTC** (`0 6 * * 1`), which POSTs
`/reindex` to the persistent indexer origin. The indexer crawls the approved
catalog into Chroma in the background.

> Chroma (the vector index) stays on the indexer host. A Worker/Durable Object
> cannot host an ANN vector store, so "in Cloudflare" means **scheduling** lives
> here while **storage** stays on the host (future: Vectorize + D1).

## Config

| Var / secret | Purpose |
|--------------|---------|
| `TRASK_INDEXER_REINDEX_URL` (var) | Indexer origin exposing `POST /reindex` (e.g. `https://indexer.example.com`). Defaults to `http://127.0.0.1:8790` for local dev. |
| `TRASK_REINDEX_TOKEN` (secret) | Shared bearer token; must match the indexer's `TRASK_REINDEX_TOKEN`. |
| `TRASK_REINDEX_LIMIT` (var, optional) | Cap crawl targets per run; empty = full catalog. |

## Deploy

```bash
pnpm --dir infra/trask-reindex-scheduler run check          # typecheck
pnpm dlx wrangler deploy --config infra/trask-reindex-scheduler/wrangler.toml --dry-run
pnpm dlx wrangler secret put TRASK_REINDEX_TOKEN --config infra/trask-reindex-scheduler/wrangler.toml
pnpm dlx wrangler deploy --config infra/trask-reindex-scheduler/wrangler.toml
```

CI (`.github/workflows/trask-reindex-scheduler.yml`) typechecks and runs
`wrangler deploy --dry-run` on every change; live deploy needs
`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` repo secrets.

## Local runtime test

```bash
# Indexer with a token, then the scheduler in dev. NOTE: trask_live_stack.sh already
# binds 8787 (retrieve Worker) and 8790 (indexer), so run the scheduler on a free port:
TRASK_REINDEX_TOKEN=dev bash scripts/trask_live_stack.sh   # indexer :8790, retrieve Worker :8787
TRASK_REINDEX_TOKEN=dev pnpm --dir infra/trask-reindex-scheduler dev --port 8799
curl -X POST "http://localhost:8799/__scheduled?cron=0+6+*+*+1"   # fire the cron handler
```

## Credential-free alternative

`.github/workflows/trask-weekly-reindex.yml` runs the same `POST /reindex` on a
weekly GitHub Actions `schedule:` when `TRASK_INDEXER_REINDEX_URL` +
`TRASK_REINDEX_TOKEN` repo secrets are set — no Cloudflare account required.
