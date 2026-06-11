# Trask research agent — 2026 standards (authority)

**Status:** Active operator reference (2026-06-11). Replacement-first; supersedes Crawl4AI/Chroma/OpenRouter-as-strategy wording in older notes.

## Pipeline (mandatory)

1. **Ingest:** Scheduled approved web crawl + DiscordChatExporter archives → normalized evidence records with freshness, hashes, deletion state, and exact citation locators.
2. **Retrieve:** Clients call **`POST /retrieve` only on the Cloudflare Worker** (`infra/trask-retrieve-worker`, local **8787**). Worker proxies to the current Chroma indexer and returns `passages` plus `evidencePack`.
3. **Authorize:** Web citations must be exact retrieved URLs. Discord citations must be exact jump links and pass destination guild/channel authorization at answer time.
4. **Compose:** `@openkotor/trask` grounded evidence — Hugging Face first, Cloudflare second, deterministic extractive fallback when hosted providers fail.

## Environment

| Variable | Value |
|----------|--------|
| `TRASK_INDEXER_BASE_URL` | `http://127.0.0.1:8787` (Worker), not `:8790` |
| `TRASK_WEB_RESEARCH_PYTHON` | `.venv-trask-research/bin/python` or indexer venv |
| `TRASK_WEB_RESEARCH_LIVE_CRAWL` | `0` (REQ-B; `trask_live_stack.sh` default) — opt-in `1` for bounded recovery only |
| `TRASK_RESEARCH_BUDGET_MS` | `30000` (REQ-C) |
| `TRASK_RESEARCH_COMPOSE_MODE` | `grounded` |
| `TRASK_GROUNDED_COMPOSE` | on (default) |
| `HF_TOKEN` / `HUGGINGFACE_TOKEN` | Primary hosted inference |
| `TRASK_CLOUDFLARE_AI_BASE_URL` + `TRASK_CLOUDFLARE_AI_TOKEN` | Cloudflare HA fallback |
| `TRASK_DISCORD_EXPORT_TARGETS_CONFIG` | Discord export target config JSON; default `data/trask/discord-export-targets.json` (see runbook for target schema) |

## Local stack

```bash
bash scripts/trask_live_stack.sh   # indexer 8790 + Worker 8787 + Holocron 4010
```

## Product requirements (REQ-A / REQ-B / REQ-C)

| ID | Summary |
|----|---------|
| REQ-A | Scheduled corpus refresh for web and Discord archives ([trask-indexed-stack-runbook.md](../50-execution/trask-indexed-stack-runbook.md)) |
| REQ-B | Query-time answers from maintained evidence cache; `TRASK_WEB_RESEARCH_LIVE_CRAWL=0` default |
| REQ-C | `TRASK_RESEARCH_BUDGET_MS=30000` end-to-end soft budget |

## Verification (agents)

1. `pnpm holocron:e2e` with Worker URL
2. Five expert queries in `data/trask/eval/verification-queries.json` via browser on `http://127.0.0.1:4010`
3. `pnpm verify:trask-discord` when bot token available
4. `pnpm trask:faithfulness-eval` after compose/citation changes

Full matrix: [validation-ladder.md](../50-execution/validation-ladder.md) §8.

## Retrieve quality (indexer)

Hybrid recall: dense Chroma query (k≈15–30) + lexical RRF + URL anchor boost → top passages. The response is an evidence pack with metadata needed for citations, agents, purge, and authorization. See `infra/trask-indexer/trask_indexer/chroma_store.py` and `retrieve_api.py`.

## Agent-native operations

```bash
node scripts/trask_ops.mjs capabilities
node scripts/trask_ops.mjs sources
node scripts/trask_ops.mjs provider-health
node scripts/trask_ops.mjs evidence "What is TSLPatcher used for?"
node scripts/trask_ops.mjs refresh-dry-run
node scripts/trask_ops.mjs purge-discord-message --channel-id <id> --message-id <id>
```

## Plan

Implementation roadmap: `docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md` (product policy) and `.cursor/plans/trask-qa-pipeline_3561ef66.plan.md` (replacement-first implementation).
