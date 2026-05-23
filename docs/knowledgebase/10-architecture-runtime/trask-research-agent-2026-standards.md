# Trask research agent — 2026 standards (authority)

**Status:** Active operator reference (2026-05-19). Supersedes DuckDuckGo-first wording in older notes.

## Pipeline (mandatory)

1. **Ingest:** Crawl4AI + Discord sync → Chroma on indexer host (`infra/trask-indexer`, port **8790** internal).
2. **Retrieve:** Clients call **`POST /retrieve` only on the Cloudflare Worker** (`infra/trask-retrieve-worker`, local **8787**). Worker proxies to Chroma.
3. **Gather:** `scripts/trask_web_research.py` → structured **`passages`** JSON (verified URLs). DDG fallback **off** in production (`TRASK_WEB_RESEARCH_DDG_FALLBACK=0`).
4. **Compose:** `@openkotor/trask` grounded evidence — citations only from passages; ≥2 `https://` sources when index supports it; abstain when insufficient.

## Environment

| Variable | Value |
|----------|--------|
| `TRASK_INDEXER_BASE_URL` | `http://127.0.0.1:8787` (Worker), not `:8790` |
| `TRASK_WEB_RESEARCH_PYTHON` | `.venv-trask-research/bin/python` or indexer venv |
| `TRASK_RESEARCH_COMPOSE_MODE` | `grounded` |
| `TRASK_GROUNDED_COMPOSE` | on (default) |

## Local stack

```bash
bash scripts/trask_live_stack.sh   # indexer 8790 + Worker 8787 + Holocron 4010
```

## Verification (agents)

1. `pnpm holocron:e2e` with Worker URL
2. Five expert queries in `data/trask/eval/verification-queries.json` via browser on `http://127.0.0.1:4010`
3. `pnpm verify:trask-discord` when bot token available
4. `pnpm trask:faithfulness-eval` after compose/citation changes

## Retrieve quality (indexer)

Hybrid recall: dense Chroma query (k≈15–30) + lexical RRF + URL anchor boost → top passages. See `infra/trask-indexer/trask_indexer/chroma_store.py`.

## Plan

Implementation roadmap: `docs/plans/2026-05-19-005-feat-trask-research-agent-2026-standards-plan.md`.
