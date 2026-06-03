---
title: Trask Q&A Architecture Brief
owner: trask-http-server
status: active
lastUpdated: 2026-05-29
---

# Trask / Holocron Q&A architecture (REQ-A/B/C)

[SYNTH] One-page crosswalk for strategized product intent vs [REPO] implementation. Supersedes scattered wording in older notes; authoritative policy remains [trask-self-hosted-research-pipeline-requirements.md](../../brainstorms/trask-self-hosted-research-pipeline-requirements.md).

## What operators often expect vs repo truth

| Wording | Repo truth |
|---------|------------|
| “Weekly refresh in Cloudflare Worker / Durable Objects” | [REPO] **Scheduling** in CF cron Worker (`infra/trask-reindex-scheduler`); **storage** in Chroma on indexer host `:8790`. No Durable Objects for vectors. |
| “Query cached corpus only” | [REPO] Default served stack: `TRASK_WEB_RESEARCH_LIVE_CRAWL=0`, retrieve via Worker `:8787`. |
| “Exhaustive semantic similarity under 30s” | [OPEN] Retrieval is **bounded top-k hybrid** (dense ANN recall ≈ 15–30 + lexical RRF), not full-corpus scan. **30s** is a **soft end-to-end budget** (`TRASK_RESEARCH_BUDGET_MS`) on gather + compose, not exhaustive retrieval SLA. |

## REQ-A — Weekly corpus refresh

- [REPO] Mondays 06:00 UTC: CF cron `scheduled()` → `POST /reindex` + bearer token.
- [REPO] Credential-free fallback: `.github/workflows/trask-weekly-reindex.yml`.
- [REPO] Indexer runs `run_batch_crawl` into Chroma (`infra/trask-indexer/trask_indexer/retrieve_api.py`).

## REQ-B — Cached index at query time

- [REPO] `scripts/trask_web_research.py` → `POST {TRASK_INDEXER_BASE_URL}/retrieve`.
- [REPO] `scripts/trask_live_stack.sh` sets Worker URL `:8787`, `LIVE_CRAWL=0`, `DDG=0`.
- [REPO] Weak retrieve → honest degrade (F3), not per-query crawl.

## REQ-C — ≤30s research budget

- [REPO] `TRASK_RESEARCH_BUDGET_MS=30000` in config + live stack.
- [REPO] `ResearchWizardClient` passes deadline into gather subprocess and compose calls.
- [SYNTH] Cached-index answers typically complete in single-digit seconds; budget bounds LLM stall fallback to grounded template.

## Retrieval (semantic hybrid, bounded)

- [REPO] `chroma_store.py`: FastEmbed query vector → Chroma `query(n_results=recall)` where `recall = min(max(limit×3, 15), 30)`.
- [REPO] Fuse dense rank + in-recall lexical tokens via RRF (k=60) + URL anchor boost → return top `limit`.
- [OPEN] True BM25 index and cross-encoder rerank deferred; Vectorize migration deferred until Chroma path stable.

## Surfaces

- [REPO] Holocron `:4010` and Discord `/ask` share `ResearchWizardClient` + grounded compose (`answer-pipeline.md`).
- [REPO] Hot path does **not** merge `FileChunkStore` chunks (`trask-synthesis-and-chunk-retrieval.md`).

## Repo implications

- **Prefer:** index-first stack, Worker-only retrieve URL, weekly REQ-A activators, evidence-labeled KB.
- **Defer:** Vectorize cutover, live crawl as default, exhaustive corpus scan promises.
- **Avoid:** treating CF Workers as vector store; conflating weekly `POST /reindex` with `/queue-reindex` drain.

## Related docs

- [trask-indexed-stack-runbook.md](../50-execution/trask-indexed-stack-runbook.md)
- [answer-pipeline.md](answer-pipeline.md)
- [caveat-register.md](../90-meta/caveat-register.md)
