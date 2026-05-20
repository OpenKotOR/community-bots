---
name: Holocron & Trask
last_updated: 2026-05-18
---

# Holocron & Trask Strategy

## Target problem

KotOR modding knowledge is scattered across Discord threads, wikis, and archives. People need answers they can trust with clear citations, without running a heavy vendored research stack or unbounded web scraping on every question.

## Our approach

Holocron and Trask combine allowlisted web research (Crawl4AI + DuckDuckGo) with lower-authority imported and live Discord context in one Node synthesis path. Ship a deployable HTTP surface for the web UI and Discord bots, with explicit source authority and approved-domain guardrails.

## Who it's for

**Primary:** Modders and lore seekers — they use Holocron to get cited, on-topic answers from approved KotOR sources.

**Secondary:** Discord server members — they ask Trask in-channel and get the same research pipeline with community context when configured.

**Operators:** Maintainers who ingest Discord history, configure env, and deploy the public Trask HTTP Space.

## Key metrics

- **Holocron e2e pass rate** — all five canonical research queries complete with substantive answers and ≥2 `https://` citations; measured by `pnpm holocron:e2e`
- **Research latency (p95)** — time from submit to final answer on `/api/trask/*`; observed in server logs and Playwright runs
- **Citations per answer** — count of distinct approved sources in the Sources panel; spot-checked in e2e and manual QA
- **HF deploy health** — Trask HTTP Space builds and serves research after `trask-http-public` workflow; GitHub Actions + Space uptime

## Tracks

### Live web research

Crawl4AI + DDG discovery with Node LLM rewrite for final Holocron answers.

_Why it serves the approach:_ Replaces the removed GPT-Researcher vendor tree with a maintainable, documented default stack.

### Community Discord retrieval

Imported chunks and optional live channel search feed `localHits` before web research.

_Why it serves the approach:_ Surfaces community knowledge without treating Discord as equal to approved web archives.

### Holocron UX

Server-backed Q&A only; source weighting and keyboard shortcuts; no client-side scraper or agent panel.

_Why it serves the approach:_ Keeps one authoritative API path and reduces drift between UI and runtime.

### Deploy and ops

Docker/HF pack, bootstrap scripts, env maps, and ingest runbooks aligned with runtime.

_Why it serves the approach:_ Operators can reproduce local and public behavior from the same contracts.

## Not working on

- Vendored GPT-Researcher / `vendor/ai-researchwizard` as the default research path
- browser-use, llm-scraper, or Firecrawl as the Holocron/Discord answer pipeline
- SearXNG/Khoj sidecars or `TRASK_RESEARCH_BACKEND_URL` HTTP replacements for `trask_web_research.py`
