# Trask / Holocron research backends

Holocron’s UI lives in **`apps/holocron-web`**. It talks to **`apps/trask-http-server`** at `/api/trask/*`.

**Product policy:** `docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md`  
**Operational cheat sheet:** `docs/solutions/tooling-decisions/trask-crawl4ai-research-cutover-2026-05-19.md`

## Default stack (replacement-ready evidence-pack RAG)

| Layer | Implementation |
|--------|----------------|
| **Corpus** | Scheduled approved web crawl plus DiscordChatExporter archives (`data/trask/discord-export-targets.json` → per-target `output_dir`) normalized into evidence records |
| **Index** | Current local implementation: FastEmbed + Chroma (`infra/trask-indexer`); replaceable behind the evidence-pack boundary |
| **Retrieve API** | Cloudflare Worker `POST /retrieve` (`infra/trask-retrieve-worker`, local **:8787**) returns `passages` plus `evidencePack` metadata |
| **Gather** | `scripts/trask_web_research.py` — Worker retrieve → optional local Chroma → bounded live crawl only when explicitly enabled |
| **Compose** | `@openkotor/trask` `ResearchWizardClient` — citation gate → Hugging Face provider → Cloudflare provider → deterministic extractive fallback |

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
| `TRASK_WEB_RESEARCH_LIVE_CRAWL` | `0` on served stack (REQ-B) — bounded recovery only when `1` |
| `TRASK_RESEARCH_COMPOSE_MODE` | `grounded` (default in live stack) |
| `TRASK_RESEARCH_GATHER_MS` / `TRASK_RESEARCH_COMPOSE_MS` | Clamped to `TRASK_RESEARCH_BUDGET_MS` (REQ-C); legacy `TRASK_RESEARCHWIZARD_TIMEOUT_MS` still honored |
| `TRASK_RESEARCH_BUDGET_MS` | `30000` (REQ-C) — soft end-to-end research budget |
| `HF_TOKEN` / `HUGGINGFACE_TOKEN` | Primary Trask hosted inference provider |
| `TRASK_HF_CHAT_MODEL`, `TRASK_HF_EMBEDDING_MODEL`, `TRASK_HF_INFERENCE_BASE_URL` | Hugging Face overrides; default chat target is Qwen3-class, embedding target is BGE-M3 |
| `TRASK_CLOUDFLARE_AI_BASE_URL`, `TRASK_CLOUDFLARE_AI_TOKEN` | Cloudflare AI Gateway / Worker fallback provider |
| `TRASK_REWRITE_MODEL_FALLBACKS` | Optional model fallback list attached to the primary Hugging Face provider |
| `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | Legacy escape hatches only; not required for primary Trask validation |
| `TRASK_QA_GROUNDING` | `1` only for QA seed — allows 1-URL sufficiency escape (not production default) |

See **`docs/knowledgebase/50-execution/trask-configuration-env-map.md`** for the full table.

### Agent-native ops

```bash
node scripts/trask_ops.mjs capabilities
node scripts/trask_ops.mjs sources
node scripts/trask_ops.mjs provider-health
node scripts/trask_ops.mjs evidence "What is TSLPatcher used for?"
node scripts/trask_ops.mjs purge-discord-message --channel-id <id> --message-id <id> # dry-run by default
```

### Verification ladder

```bash
pnpm trask:smoke-imports              # build + workspace package import smoke
pnpm trask:gate                       # one build, smoke, config-drift, full measure (skip-check), :ci (floor 165)
pnpm trask:faithfulness-eval          # faithfulness fixtures only (subset of optimize-measure)
pnpm verify:trask-cli                 # trask:gate preflight, then CLI golden queries
pnpm holocron:e2e                     # trask:gate preflight, then Playwright (expert queries, :4010)
pnpm verify:trask-discord             # trask:gate preflight, then live Discord expert queries
```

CI runs `pnpm build`, **`pnpm trask:gate:ci`**, indexer+Worker bootstrap, **`pnpm trask:verify-import-smoke:ci`**, then `pnpm holocron:e2e:playwright` with `TRASK_SKIP_BUILD=1` (local `pnpm holocron:e2e` runs full `trask:gate` first).

## Explicitly rejected (do not implement)

| Approach | Reason |
|----------|--------|
| DuckDuckGo as **primary** grounded evidence | Index-first; DDG optional recovery only |
| Node-native **llm-scraper** | Not product path |
| **browser-use** integration | Not product path |
| Firecrawl as Holocron/Discord answer pipeline | Ingest-worker only |
| Local Ollama as default compose | HF/Cloudflare hosted path plus deterministic fallback instead |
| GPT-Researcher / vendored research-wizard as default | Removed |

## Other references (not default)

- [khoj-ai/khoj](https://github.com/khoj-ai/khoj) — full Q&A product (not integrated)
- [searxng/searxng](https://github.com/searxng/searxng) — metasearch sidecar (not integrated)
