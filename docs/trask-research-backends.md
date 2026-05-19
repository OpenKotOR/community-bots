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
# OPENAI_API_KEY or OPENROUTER_API_KEY required for Holocron synthesis
```

Fedora/RHEL hosts need `libxml2-devel` and `libxslt-devel` before the first bootstrap (for `lxml`).

### Environment

| Variable | Purpose |
|----------|---------|
| `TRASK_WEB_RESEARCH_PYTHON` | Python for `scripts/trask_web_research.py` (defaults to `.venv-trask-research`) |
| `TRASK_WEB_RESEARCH_SCRIPT` | Optional override script path |
| `TRASK_GPT_RESEARCHER_PYTHON` | Deprecated alias for `TRASK_WEB_RESEARCH_PYTHON` |
| `TRASK_WEB_RESEARCH_TIMEOUT_MS` | Subprocess timeout (default **900000**; legacy alias `TRASK_RESEARCHWIZARD_TIMEOUT_MS`) |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | LLM rewrite for final Holocron answers |

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
