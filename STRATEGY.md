---
name: Holocron & Trask
last_updated: 2026-06-13
---

# Holocron & Trask Strategy

## Target problem

KotOR modding knowledge is scattered across Discord, wikis, and file-host threads. Modders and lore seekers need trustworthy, cited answers without hunting multiple sites — but today’s answers often read like raw retrieval dumps (claim bullets, markdown leaks, weak bibliographies) when the owned RAG stack is not fully engaged.

## Our approach

**Owned evidence cache → retrieve → authorize citations → compose or extract.** Trask is a fast KotOR research agent over an ahead-of-time cache of approved web sources and Discord archives. Current internals such as Crawl4AI, Chroma, FastEmbed, and the retrieve Worker are implementation candidates, not strategy commitments: they stay only when they beat replacements on citation quality, source freshness, latency, deletion support, maintainability, and free-tier operation.

The durable contract is source-first: every factual answer must be backed by exact public URLs or authorized Discord jump links, and answers should complete inside a 10-30 second budget. Hugging Face-hosted inference is the first compose/classification path, Cloudflare is the HA fallback, and deterministic extractive answers are required when hosted providers are unavailable. `OPENAI_API_KEY` is not part of the primary Trask validation path.

## Who it's for

**Primary:** Modders and lore seekers — they use Holocron to get cited, conversational answers grounded in approved KotOR archives.

**Secondary:** Discord server members — they ask Trask in-channel and get the same RAG + compose pipeline with optional community context when configured.

**Operators:** Maintainers who approve sources, inspect freshness, trigger or dry-run refreshes, purge Discord evidence, monitor provider health, and deploy the public Trask HTTP surface.

## Key metrics

- **Grounded answer quality** — responses read like Trask, a messenger of the Colossal Holocron, with citations aligned to retrieved evidence and no unsupported roleplay
- **Citation integrity** — web citations are exact `https://` URLs; Discord citations are exact jump links authorized for the destination surface at answer time
- **Evidence freshness** — approved web sources and DiscordChatExporter archives expose last-refresh, hash, deletion/tombstone, and reconciliation state
- **Research latency (p95)** — submit → final answer on `/api/trask/*` or Discord `/ask` stays inside the 10-30 second budget, including provider fallback

## Tracks

### Citation-First Evidence Cache

Scheduled web and Discord ingestion normalize approved material into citation-ready evidence records. The crawler/parser and backing store may be Crawl4AI/Chroma, Trafilatura/Docling plus Qdrant/LanceDB/sqlite-vec, or Cloudflare-native storage if they meet the replacement gates.

**Two-repo Discord pipeline (2026-06):** append-only archives are scraped in the DiscordChatExporter fork (`feat/recurring-cli-scrape`); Trask indexes from `community-bots` via `data/trask/discord-export-targets.json` and `scripts/trask_discord_sync.py`. Indexer accepts bot-export `manifest.json` + `containers/` **or** DCE flat `* [channel_id].json`. KotOR `yes_general` (`221726893064454144`) is the pilot allowlist target — enable only after post-scrape sync proves `channels_indexed ≥ 1`. Runbook: `docs/knowledgebase/50-execution/discordchat-exporter-trask-bridge-runbook.md`.

_Why it serves the approach:_ Users trust Trask when every answer can be traced to exact, authorized sources.

### Hugging Face-First Compose

Hugging Face handles primary answer generation, proactive classification, and optional rerank where configured. Cloudflare provides HA fallback. If both fail, Trask returns a cited extractive answer or a clear insufficient-evidence response.

_Why it serves the approach:_ Free-first hosted inference keeps answers quick without making OpenAI/OpenRouter credentials a product dependency.

### Holocron & Discord surfaces

Server-backed Q&A only; one evidence-pack contract for web, Discord, and agent tooling; source weighting without client-side scrapers.

_Why it serves the approach:_ Prevents UI/runtime drift and keeps citations authoritative.

### Deploy and ops

Agent-readable actions for source listing, freshness inspection, dry-run refresh, purge requests, evidence inspection, provider health, and proactive-reply traces.

_Why it serves the approach:_ Operators and agents can reproduce local behavior before shipping public Holocron.

**Requirements detail:** `docs/brainstorms/trask-self-hosted-research-pipeline-requirements.md`

## Not working on

- Vendored GPT-Researcher / `vendor/ai-researchwizard` as the default research path
- DuckDuckGo snippets as primary evidence when the maintained evidence cache can serve the query
- browser-use, llm-scraper, or Firecrawl as the Holocron/Discord answer pipeline
- `OPENAI_API_KEY` / OpenRouter as a primary Trask validation requirement
