---
title: Trask RAG fidelity and edge retrieve
status: active
date: 2026-05-19
---

# Trask RAG fidelity and edge retrieve

## Problem

Discord `/ask` (and shared Holocron/CLI paths) must answer from **retrieved Chroma passages**, not from a catalog of approved host roots. Replies that list five unrelated golden topics with tidy `kotor.neocities.org/modding/<topic>/` URLs read as hallucinated even when those URLs exist in the seed index.

## Decision (agent-owned)

**Shared RAG core** for retrieve → passages → grounded compose → citation alignment across Holocron, Discord, and CLI. **Surface profiles only** differ: Discord uses `brief` compose + `formatDiscordAskDisplay`; Holocron keeps full Sources UI.

Chroma remains on a **persistent indexer** (`infra/trask-indexer`). **Cloudflare Workers** host an edge `POST /retrieve` (`infra/trask-retrieve-worker`) that proxies to the indexer now and can swap to Vectorize later without changing the Trask client contract.

## Requirements

- R1. Every public citation URL in an answer must appear in **retrieved passage metadata** for that query (no catalog-root invention).
- R2. Compose must **prefer query-anchored passages** (e.g. `tslpatcher` for TSLPatcher questions), not all top-k distinct URLs from the seed corpus.
- R3. Discord `/ask`: ≤5 lines, inline `[n](url)` only, no Sources embed field.
- R4. When grounding is insufficient, return **honest degradation** (short failure + optional source list), not a fluent multi-topic essay.
- R5. Holocron and CLI use the same retrieve/grounding path; faithfulness eval and `verify:trask-cli` remain gates.
- R6. Edge retrieve Worker documented and deployable via Wrangler; indexer URL configurable by env/secret.

## Scope boundaries

- Replacing Chroma with Vectorize in this pass (Worker proxies to Chroma indexer only).
- Discord CI automation with bot tokens.
- Re-crawling the full web corpus (use existing seed + sync scripts).

### Deferred to follow-up work

- Vectorize + D1 passage store on Workers (native RAG per Cloudflare guidance).
- Playwright-in-CI for Discord `/ask`.

## Success criteria

- Three golden Discord queries return **on-topic** briefings with ≥2 linked citations from **deep** retrieved URLs.
- TSLPatcher query cites `…/modding/tslpatcher/` and does not lead with reone/MDLOps unless retrieved as secondary evidence.
- `pnpm holocron:e2e` and `pnpm verify:trask-cli` stay green.

## Key decisions

- **Shared retrieval, surface-specific presentation** — fixes root cause once; avoids Discord-only drift.
- **Anchor-token passage filter** — reduces “dump entire seed index” behavior on small QA corpora.
- **Edge proxy before Vectorize** — satisfies Workers/Wrangler hosting without blocking on embedding migration.
