---
name: Holocron & Trask
last_updated: 2026-05-19
---

# Holocron & Trask Strategy

## Target problem

KotOR modding knowledge is scattered across Discord, wikis, and file-host threads. Modders and lore seekers need trustworthy, cited answers without hunting multiple sites — but today’s answers often read like raw retrieval dumps (claim bullets, markdown leaks, weak bibliographies) when the owned RAG stack is not fully engaged.

## Our approach

**Owned crawl → embed → retrieve → cite → assistant compose.** Crawl4AI indexes allowlisted sources into Chroma (FastEmbed vectors); every question runs hybrid RAG retrieval first, with bounded live Crawl4AI fetch on weak or empty index hits. Node synthesis rewrites retrieved passages into a conversational, AI-assistant answer with inline [n] citations and a clean Sources bibliography — never unverified snippet padding.

## Who it's for

**Primary:** Modders and lore seekers — they use Holocron to get cited, conversational answers grounded in approved KotOR archives.

**Secondary:** Discord server members — they ask Trask in-channel and get the same RAG + compose pipeline with optional community context when configured.

**Operators:** Maintainers who seed Chroma, run `trask_live_stack.sh`, configure env/LLM keys, and deploy the public Trask HTTP surface.

## Key metrics

- **Grounded answer quality** — responses read as assistant prose with ≥2 distinct `https://` citations when evidence supports it; spot-checked in Holocron UI and Discord `/ask`
- **RAG retrieve hit rate** — `passages_count > 0` and `index_miss=false` on expert verification queries; logged in `trask_web_research.py` stderr and research trace JSON
- **Live crawl recovery rate** — share of weak-retrieve queries where bounded Crawl4AI live index returns usable passages (`live_crawl_passages` in research diagnostics)
- **Research latency (p95)** — submit → final answer on `/api/trask/*`; server logs and manual QA

## Tracks

### Crawl4AI + Chroma RAG

Crawl4AI crawl/chunk, FastEmbed vectors, Chroma hybrid retrieve, bounded live crawl on miss.

_Why it serves the approach:_ Replaces opaque vendor research with an owned, inspectable retrieval path the team can seed, crawl, and debug.

### Grounded assistant compose

LLM rewrite of retrieved passages into conversational answers with aligned Sources bibliographies.

_Why it serves the approach:_ Users expect an AI assistant, not a research digest; compose must stay tied to verified passages.

### Holocron & Discord surfaces

Server-backed Q&A only; one API contract for web and Discord; source weighting without client-side scrapers.

_Why it serves the approach:_ Prevents UI/runtime drift and keeps citations authoritative.

### Deploy and ops

`trask_live_stack.sh`, indexer + Worker + HTTP env maps, HF/Docker deploy parity.

_Why it serves the approach:_ Operators and agents can reproduce local behavior before shipping public Holocron.

**Requirements detail:** `docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md`

## Not working on

- Vendored GPT-Researcher / `vendor/ai-researchwizard` as the default research path
- DuckDuckGo snippets as primary evidence when Crawl4AI + Chroma can serve the query
- browser-use, llm-scraper, or Firecrawl as the Holocron/Discord answer pipeline
- Automated test suites for Trask while the RAG/compose contract is still in active design (manual stack smoke + UI QA instead)
