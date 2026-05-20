---
date: 2026-05-19
topic: trask-crawl4ai-rag
status: draft
supersedes-partially: trask-grounded-qa-requirements.md
---

# Trask / Holocron — Crawl4AI + Self-Hosted Vector RAG

## Summary

Replace the legacy vendor research / OpenRouter research path with a **self-hosted pipeline**: approved-host crawling (Crawl4AI), CPU embeddings (free ONNX models), a vector index (Chroma or equivalent), hybrid retrieval, and **extractive grounded answers** with mandatory `https://` citations. Node keeps Holocron and Discord API contracts; Python workers on VPSes own crawl, embed, and index.

---

## Problem Frame

The current stack depends on a monolithic legacy vendor research subprocess, vendor LLM routing, and URL-level citation padding. That path is costly, opaque, and hard to ground in verifiable passages. The product goal is unchanged: **tool-grade KOTOR/modding answers** with honest uncertainty—but the mechanism must be **owned crawl → chunk → embed → retrieve → cite**, without GPU and without paid embedding APIs.

**[REPO]** Today: `ResearchWizardClient` + `vendor/removed vendor research tree` (submodule may be empty); **no** `scripts/trask_web_research.py`, **no** Crawl4AI, **no** Chroma in tree. `packages/retrieval` already provides approved hosts, `FileChunkStore`, and ingest-worker patterns to reuse.

---

## Assumptions

- **No legacy vendor research, no OpenRouter, no OpenAI for retrieval or embeddings** on the new path.
- **Several Linux VPS** available; **no GPU** on any node.
- Embeddings must be **free (open weights), fast on CPU, and good enough** for English toolchain Q&A—not necessarily “largest” models if that conflicts with speed.
- A **small local CPU LLM** on VPS for fluency-only compose is optional later; **v1 compose is extractive** (quotes + bullets).
- Holocron production still requires **≥2 distinct approved `https://` sources** per answer (existing e2e contract).

---

## Actors

| Actor | Need |
|--------|------|
| Holocron user | Accurate, cited answers from real archived pages |
| Discord `/ask` user | Same evidence bar within shorter SLA |
| Operator | Reindex approved sources; inspect index health |
| Indexer workers (VPS) | Crawl, chunk, embed, upsert without OOM |

---

## Key Flows

### F1 — Background index (continuous)

1. Reindex queue or catalog cron enqueues approved source roots.
2. Crawl4AI fetches allowlisted URLs (rate-limited, robots-aware).
3. Markdown is chunked with stable ids and metadata (url, host, source_id, content_hash).
4. CPU embedder batches passages into the vector store.
5. Lexical index (BM25 or FTS) updated in parallel for hybrid search.

### F2 — Holocron question (query)

1. User asks; optional source weights filter hosts/sources.
2. Query is embedded with the **same model** as ingest.
3. Hybrid retrieve: dense top-k + lexical top-k → merge (RRF) → allowlist filter → optional cross-encoder rerank on CPU.
4. Optional **bounded live crawl** (3–5 allowlisted URLs only)—not open web search.
5. Evidence pack: ranked passages with quotes.
6. Extractive compose: answer bullets + `[n]` cites; Sources lists **only cited** URLs.
7. If &lt;2 independent supporting passages → abstain / source-only guidance.

### F3 — Operator reindex

1. Operator queues source id (existing CLI/Discord patterns).
2. Indexer VPS drains job; corpus updates incrementally by content_hash.

---

## Requirements

### Crawl and corpus

- **R-1** Only **approved catalog hosts and URL prefixes** may be crawled and indexed (reuse existing allowlist semantics).
- **R-2** Each stored passage must retain **canonical URL, host, source_id, fetch time, and content hash**.
- **R-3** Crawl jobs must be **rate-limited** and **robots-aware**; blocked hosts (e.g. Cloudflare-gated wikis) are excluded or manually seeded—not brute-forced.

### Embeddings and index

- **R-4** Embeddings must run on **CPU with free open-weight models** (no paid embedding API).
- **R-5** **Same embedding model** for ingest and query; version pinned and reindexable on change.
- **R-6** Retrieval must be **hybrid** (dense + lexical) for toolchain token accuracy.
- **R-7** Vector store must support **metadata filters** (host, source_id) and backups on VPS.

### Answers and citations

- **R-8** Every factual bullet must map to a **retrieved passage quote**, not model prior knowledge.
- **R-9** **Sources shown to users** must be a subset of URLs **cited in the answer body** (no URL padding).
- **R-10** Holocron answers must include **≥2 distinct approved `https://` citations** when claiming a grounded answer, or abstain.
- **R-11** **No `local://` or `discord://`** in Holocron public Sources (local digest may inform retrieve but not satisfy citation contract).

### API and surfaces

- **R-12** **`trask-http-server` contract unchanged**: `POST /ask`, 202 + thread poll, progress phases, source preferences.
- **R-13** Discord and Holocron share the **same retrieval and citation rules**.
- **R-14** Five canonical Holocron e2e queries remain the **smoke gate** after backend swap.

### Operations

- **R-15** Roles split across VPS: **crawler**, **embedder/index**, **API** (may co-locate API + vector only if resources allow).
- **R-16** Index snapshots or replication strategy documented for restore/disaster.

---

## Acceptance Examples

**AE-1 — Indexed TSLPatcher answer**  
For “What is TSLPatcher used for in KOTOR modding?”, retrieve passages from pre-indexed approved hosts; answer mentions patching 2DA/GFF/TLK (or equivalent) with each claim tied to a stored quote and ≥2 `https://` cites.

**AE-2 — No citation padding**  
If compose produces no `[n]` markers, user sees abstention—not a Sources list of visited-but-uncited URLs.

**AE-3 — Hybrid recall for tool name**  
Query “MDLOps” returns relevant passages via lexical or hybrid rank even when wording differs slightly in the index.

**AE-4 — Reindex updates corpus**  
After reindexing a source, a query that previously missed ingested content can return new passages (measurable on one golden query).

**AE-5 — VPS failure degradation**  
If vector service is down, API returns explicit failure—not a confident hallucinated answer.

---

## Success Criteria

1. All five Holocron e2e queries pass with **`TRASK_RESEARCH_BACKEND=indexed`** (or successor flag) without legacy vendor research.
2. No OpenAI/OpenRouter/legacy vendor research calls on the research/retrieve path (compose extractive only in v1).
3. Median Holocron query completes within existing client timeout budget on CPU hardware used in prod.
4. Operator can reindex one catalog source and observe new passages in retrieve results.
5. Human review on ≥10 toolchain questions shows **fewer unsupported “absolute” facts** than legacy vendor research baseline (baseline captured before cutover).

---

## Scope Boundaries

**In scope**

- Crawl4AI indexer service(s) on VPS
- Chroma (or agreed alternative) + FastEmbed-class CPU models
- Hybrid retrieval + extractive compose in `@openkotor/trask`
- `ResearchBackend` port replacing legacy vendor research subprocess
- Reuse `@openkotor/retrieval` allowlist + ingest queue patterns
- Holocron trust UX (provenance, hosts in progress) aligned with indexed backend

**Deferred for later**

- GPU inference
- Paid cloud embeddings or search APIs for retrieval
- General open-web search (Tavily, etc.) on the new path
- Large local LLM compose on VPS
- turbopuffer / enterprise vector BYOC
- Discord chat as factual ground truth

**Outside this product's identity**

- Answers without approved-web provenance on public Holocron
- Narrative essays uncited from the index

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| **Abandon legacy vendor research for research** | User mandate; self-hosted control and cost |
| **Crawl4AI for fetch/markdown** | Python-native, batch crawl, pruning filters |
| **FastEmbed + bge-small-en-v1.5 default** | Free, fast CPU ONNX; upgrade only if recall fails |
| **Chroma central on dedicated VPS (v1)** | Simplest multi-writer index; export path to sqlite-vec later |
| **Hybrid BM25 + dense** | Modding queries need exact tokens and semantics |
| **Extractive compose v1** | Grounding without vendor LLM |
| **Node API + Python indexer/retrieve** | Matches existing monorepo split |

---

## Dependencies / Assumptions

- VPS with enough RAM for Chromium (crawl) and ONNX embed batches (separate processes preferred).
- Shared storage or replication between indexer and vector host.
- Playwright/Chromium install on crawler VPS.
- Pre-crawl golden corpus **before** disabling legacy vendor research in production.

---

## Outstanding Questions

- Chroma vs Qdrant for v1 (Chroma recommended for simplicity; Qdrant if native hybrid RRF is preferred).
- Whether bounded live crawl is in v1 or phase 2 after index-only proves e2e.
- Where proactive Discord embeddings migrate (CPU embedder vs disable proactive until parity).

---

## Navigation

- Prior brainstorm (legacy vendor research grounding): [trask-grounded-qa-requirements.md](trask-grounded-qa-requirements.md) — partially superseded
- Next-steps ideation: [../ideation/2026-05-19-trask-grounded-qa-next-steps-ideation.md](../ideation/2026-05-19-trask-grounded-qa-next-steps-ideation.md)
- Allowlist: [../knowledgebase/20-domain-theory/kotor-modding-source-map.md](../knowledgebase/20-domain-theory/kotor-modding-source-map.md)
- E2e: [../../apps/holocron-web/e2e/holocron-research.spec.ts](../../apps/holocron-web/e2e/holocron-research.spec.ts)
