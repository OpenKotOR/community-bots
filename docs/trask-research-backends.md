# Trask / Holocron research backends

Holocron’s UI lives in **`apps/holocron-web`**. It talks to **`apps/trask-http-server`** at `/api/trask/*`.

## Default stack (implemented)

| Layer | Implementation |
|--------|----------------|
| **Discovery** | DuckDuckGo (`duckduckgo-search`) with `site:` hints from approved domains |
| **Scrape** | [Crawl4AI](https://github.com/unclecode/crawl4ai) → LLM-friendly markdown (`scripts/trask_web_research.py`) |
| **Synthesis** | Node `WebResearchClient` OpenAI-compatible rewrite (`packages/trask/src/web-research.ts`) |

### Bootstrap

```bash
bash scripts/bootstrap_trask_research.sh   # creates .venv-trask-research
export TRASK_WEB_RESEARCH_PYTHON="$(pwd)/.venv-trask-research/bin/python"
# LLM: OPENROUTER_API_KEY (free models), LITELLM_PROXY_URL / OPENCODE_LLM_PROXY_URL, or OPENAI_API_KEY
```

Fedora/RHEL hosts need `libxml2-devel` and `libxslt-devel` before the first bootstrap (for `lxml`).

### Environment

| Variable | Purpose |
|----------|---------|
| `TRASK_WEB_RESEARCH_PYTHON` | Python for `scripts/trask_web_research.py` (defaults to `.venv-trask-research`) |
| `TRASK_WEB_RESEARCH_SCRIPT` | Optional override script path |
| `TRASK_GPT_RESEARCHER_PYTHON` | Deprecated alias for `TRASK_WEB_RESEARCH_PYTHON` |
| `TRASK_WEB_RESEARCH_TIMEOUT_MS` | Subprocess timeout (default **900000**; legacy alias `TRASK_RESEARCHWIZARD_TIMEOUT_MS`) |
| `OPENROUTER_API_KEY` | Recommended: free-tier models via OpenRouter (`openrouter/openrouter/free` default) |
| `LITELLM_PROXY_URL` / `OPENCODE_LLM_PROXY_URL` / `TRASK_LLM_BASE_URL` | OpenAI-compatible proxy (LiteLLM or OpenCode plugin); key `sk-local` for sample proxy |
| `OPENAI_API_KEY` / `GROQ_API_KEY` / … | Direct providers; paid fallbacks when `TRASK_LLM_PROFILE=paid` |
| `TRASK_LLM_PROFILE` | `free` (default) or `paid` — model + fallback ordering in `@openkotor/config` (`loadSharedAiConfig`) |
| `TRASK_LLM_MODEL` | LiteLLM/OpenCode proxy alias (default `trask-research` when a proxy URL is set) |
| `FAST_LLM` / `SMART_LLM` / `TRASK_REWRITE_MODEL_FALLBACKS` | Override defaults; see `python scripts/trask_print_fallback_llm.py` + vendored `llm_fallbacks` |
| `REDIS_URL` / `TRASK_REDIS_URL` | Optional Redis for research cache (`scripts/trask_cache.py`) |
| `TRASK_CACHE_DISABLED` | Set to `1` to bypass Redis even when `REDIS_URL` is set |
| `TRASK_CACHE_SEARCH_TTL_SECONDS` | DuckDuckGo URL-list cache TTL (default **21600** = 6h) |
| `TRASK_CACHE_PAGE_TTL_SECONDS` | Per-page markdown cache TTL (default **604800** = 7d) |
| `TRASK_CACHE_RESEARCH_TTL_SECONDS` | Full research JSON cache TTL (default **3600** = 1h) |

### LiteLLM proxy (free → paid fallbacks)

Sample config: **`infra/trask-litellm/litellm_config.yaml`** (alias **`trask-research`**). Start the proxy, then point Holocron at it:

```bash
pip install 'litellm[proxy]'   # or: uv tool install 'litellm[proxy]'
bash scripts/trask_litellm_proxy.sh   # :4000, loads .env / .env.local

# In .env.local (provider keys stay in LiteLLM's environment):
# OPENROUTER_API_KEY=sk-or-...
# LITELLM_PROXY_URL=http://127.0.0.1:4000
# LITELLM_API_KEY=sk-local
# TRASK_LLM_MODEL=trask-research
# TRASK_LLM_PROFILE=free

pnpm build && bash scripts/trask_live_stack.sh
```

Fallback chain (proxy-side): `trask-research` (OpenRouter free router) → `trask-research-llama-free` → `trask-research-groq` (if `GROQ_API_KEY`) → `trask-research-paid` → `trask-research-openai`. See **`infra/trask-litellm/README.md`**.

Smoke:

```bash
curl -sf http://127.0.0.1:4000/health/liveliness
```

For dozens of OpenRouter `:free` models, use the generated catalog in **`vendor/llm_fallbacks/configs/litellm_config_free.yaml`** instead of the minimal sample.

### Redis cache (optional, no Pinecone)

When `REDIS_URL` is set, `scripts/trask_web_research.py` uses `scripts/trask_cache.py` to avoid repeat work:

| Layer | Key pattern | What it skips |
|--------|-------------|----------------|
| Search | `trask:search:{hash}` | DuckDuckGo discovery for the same query + domains |
| Page | `trask:page:{hash}` | Crawl4AI / trafilatura fetch for the same URL |
| Research | `trask:research:{hash}` | Entire subprocess result for identical payload |

Cache stats appear under `research_information.cache` (e.g. `page_hits`, `search_misses`, `research_hits`).

```bash
# Local Redis (example)
podman run -d --name trask-redis -p 6379:6379 redis:7-alpine
export REDIS_URL=redis://localhost:6379/0
python scripts/trask_cache.py   # connectivity self-test
```

### Verification

```bash
python scripts/smoke_trask_web_research.py --dry-run
node --import tsx/esm scripts/verify_trask_cli_qa.mjs
pnpm holocron:e2e   # with trask-http-server on :4010
```

## Explicitly rejected (do not implement)

These were considered as follow-ups and are **out of scope**:

| Approach | Reason |
|----------|--------|
| Node-native **llm-scraper** for single-URL extraction | Not part of the product path; Crawl4AI + DDG covers live research. |
| **browser-use** integration | Not part of the product path. |
| Trask `/ask` via self-hosted **Firecrawl HTTP API** (reuse ingest key without Python) | Firecrawl remains **ingest-worker only** when `FIRECRAWL_API_KEY` is set—not the Holocron/Discord answer pipeline. |
| `TRASK_RESEARCH_BACKEND_URL` HTTP sidecar | Reserved env name only; no planned sidecar replacing `trask_web_research.py`. |

## Other references (not default)

- [khoj-ai/khoj](https://github.com/khoj-ai/khoj) — full Q&A product (not integrated)
- [assafelovic/gpt-researcher](https://github.com/assafelovic/gpt-researcher) — upstream of the removed vendored fork
- [searxng/searxng](https://github.com/searxng/searxng) — metasearch sidecar (not integrated)
