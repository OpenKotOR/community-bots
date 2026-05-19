---
title: OpenKOTOR Community Bots Strategy
last_updated: 2026-05-19
---

# OpenKOTOR Community Bots Strategy

## Target problem

KOTOR modding communities need trustworthy, source-grounded answers and lightweight game/social tooling in Discord and the browser — without sending users through stale wikis, broken links, or opaque AI hallucinations.

## Our approach

Ship a small monorepo of focused surfaces (Trask Q&A, PazaakWorld, HK-86) that share retrieval, config, and deployment patterns. Trask answers only from an allowlisted corpus (web, GitHub, Discord index) with explicit citations; gameplay and roles stay in their own bots. Prefer local verification (Playwright, CLI smoke, Node tests) before claiming a path works.

## Who it's for

- **Discord members** asking modding/tooling questions via `/ask` and reading cited briefings.
- **Holocron users** doing deeper research in the browser with the same backend.
- **Operators/maintainers** running bots, indexer, and ingest on a single repo with documented env maps.

## Key metrics

| Metric | Where measured |
|--------|----------------|
| `/ask` acknowledges within Discord SLA (defer visible) | Manual Discord smoke + handler unit tests |
| Holocron golden-query pass rate | `pnpm holocron:e2e` (5 canonical queries) |
| CLI faithfulness on golden set | `pnpm verify:trask-cli` |
| Index retrieve health | `trask-indexer` `/health`, `scripts/smoke_trask_indexed_stack.py` |

## Tracks

1. **Trask RAG + compose** — Chroma indexer, Crawl4AI runner, grounded compose, index-miss abstention (active).
2. **Discord reliability** — Always-on bot process, early interaction defer, channel allowlist verification (active).
3. **PazaakWorld** — Nakama-first gameplay; legacy HTTP bot for OAuth where needed.
4. **Holocron UX** — GitHub Pages static client; `trask-http-server` for local/ops.

## Not working on

- General-purpose chatbot without citations or allowlist.
- Replacing Discord itself or building a full forum product.
- Non-KOTOR game support in this repo.
