# Trask / Holocron research backends

Holocron’s UI lives in **`apps/holocron-web`**. It talks to **`apps/trask-http-server`** at `/api/trask/*`.

**Product policy:** `docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md`  
**Operational cheat sheet:** `docs/solutions/tooling-decisions/trask-crawl4ai-research-cutover-2026-05-19.md`

## Default stack (index-first RAG)

| Layer | Implementation |
|--------|----------------|
| **Index** | Crawl4AI + FastEmbed + Chroma (`infra/trask-indexer`, `bash scripts/bootstrap_trask_indexer.sh`) |
| **Retrieve API** | Cloudflare Worker `POST /retrieve` (`infra/trask-retrieve-worker`, local **:8787**) — clients must not hit raw Chroma |
| **Gather** | `scripts/trask_web_research.py` — Worker retrieve → optional local Chroma → bounded live crawl on weak hit → DDG only if `TRASK_WEB_RESEARCH_DDG_FALLBACK=1` |
| **Compose** | `@openkotor/trask` `ResearchWizardClient` — grounded passages → sufficiency gate → OpenRouter `:free` + `vendor/llm_fallbacks` |

### Bootstrap

```bash
bash scripts/bootstrap_trask_research.sh   # Python venv for gather script
bash scripts/bootstrap_trask_indexer.sh    # indexer deps + Chroma data dir
bash scripts/trask_live_stack.sh           # indexer :8790 → Worker :8787 → HTTP :4010
bash scripts/trask_crawl_catalog.sh --dry-run   # list allowlist seeds (batch corpus)
bash scripts/trask_crawl_catalog.sh --limit 3   # Crawl4AI batch index (operator)
```

Fedora/RHEL hosts need `libxml2-devel` and `libxslt-devel` before the first bootstrap (for `lxml`).

### Environment

| Variable | Purpose |
|----------|---------|
| `TRASK_INDEXER_BASE_URL` | **Worker retrieve** (`http://127.0.0.1:8787` local); not raw Chroma :8790 |
| `TRASK_WEB_RESEARCH_PYTHON` | Python for `scripts/trask_web_research.py` (defaults to `.venv-trask-research`) |
| `TRASK_WEB_RESEARCH_DDG_FALLBACK` | `0` (default in live stack) — DDG is recovery-only, not primary grounded evidence |
| `TRASK_WEB_RESEARCH_LIVE_CRAWL` | `1` in live stack — bounded allowlisted Crawl4AI recovery on weak retrieve |
| `TRASK_RESEARCH_COMPOSE_MODE` | `grounded` (default in live stack) |
| `TRASK_RESEARCH_GATHER_MS` / `TRASK_RESEARCH_COMPOSE_MS` | Tiered timeouts (see env map); legacy `TRASK_RESEARCHWIZARD_TIMEOUT_MS` still honored |
| `OPENROUTER_API_KEY` | Free-tier compose via OpenRouter (`openrouter/free` default) |
| `TRASK_LLM_PROFILE` | `free` (default) or `paid` — `@openkotor/config` |
| `TRASK_REWRITE_MODEL_FALLBACKS` | Override; else loaded from `vendor/llm_fallbacks/configs/free_models_ids.txt` |
| `LITELLM_PROXY_URL` | Optional LiteLLM proxy (`bash scripts/trask_litellm_proxy.sh`) |
| `TRASK_QA_GROUNDING` | `1` only for QA seed — allows 1-URL sufficiency escape (not production default) |

See **`docs/knowledgebase/50-execution/trask-configuration-env-map.md`** for the full table.

### LiteLLM proxy (free → paid fallbacks)

Minimal sample: **`infra/trask-litellm/litellm_config.yaml`**. Full `:free` catalog:

```bash
TRASK_LITELLM_CONFIG=vendor/llm_fallbacks/configs/litellm_config_free.yaml bash scripts/trask_litellm_proxy.sh
```

### Verification ladder

```bash
pnpm trask:gate                       # recommended offline: build + full + CI optimize-measure (floor 165)
pnpm trask:faithfulness-eval          # faithfulness fixtures only (subset of optimize-measure)
pnpm verify:trask-cli                 # trask:gate preflight, then CLI golden queries
pnpm holocron:e2e                     # trask:gate preflight, then Playwright (expert queries, :4010)
pnpm verify:trask-discord             # trask:gate preflight, then live Discord expert queries
```

CI runs `pnpm build`, `pnpm trask:optimize-measure:ci`, then `pnpm holocron:e2e:playwright` with `TRASK_SKIP_BUILD=1` (local `pnpm holocron:e2e` runs full `trask:gate` first).

## Explicitly rejected (do not implement)

| Approach | Reason |
|----------|--------|
| DuckDuckGo as **primary** grounded evidence | Index-first; DDG optional recovery only |
| Node-native **llm-scraper** | Not product path |
| **browser-use** integration | Not product path |
| Firecrawl as Holocron/Discord answer pipeline | Ingest-worker only |
| Local Ollama as default compose | OpenRouter free + `llm_fallbacks` instead |
| GPT-Researcher / vendored research-wizard as default | Removed |

## Other references (not default)

- [khoj-ai/khoj](https://github.com/khoj-ai/khoj) — full Q&A product (not integrated)
- [searxng/searxng](https://github.com/searxng/searxng) — metasearch sidecar (not integrated)
