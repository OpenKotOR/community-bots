---
date: 2026-05-19
topic: trask-owned-rag-research-pipeline
status: active
origin: user-request-free-self-host-best-practice-research
---

# Trask / Holocron owned RAG research pipeline

## Summary

Trask and Holocron stay on the **owned crawl → embed → retrieve → cite → compose** stack already in this repo. The product goal is **cited, assistant-quality Q&A** over an allowlisted KotOR modding corpus—not open-web agent loops or platform replatforms. **Compose uses free cloud LLMs** (OpenRouter `:free` models with the vendored **`bolabaden/llm_fallbacks`** chain); **local inference is out of scope**. Next work hardens retrieval and grounding gates, wires the full fallback catalog, and expands the batch corpus—not a GPT-Researcher-style rewrite or mandatory paid search APIs.

---

## Problem Frame

Modders and Discord users ask practical KotOR questions and expect answers that read like a helpful assistant: clear prose, inline citations, and a Sources list they can verify. When retrieval is weak or compose runs without enough evidence, answers degrade into digest bullets, markdown leaks, or fluent guesses— which erodes trust faster than an honest “not enough sources.”

The repo already invested in Crawl4AI indexing, Chroma hybrid retrieve, and grounded compose in Node. Replatforming to RAGFlow, Onyx, Khoj, or GPT-Researcher would discard that shape without fixing the actual failure modes: **empty or thin retrieve**, **compose before sufficiency is checked**, and **LLM fallback chains that don’t match operator expectations** (OpenRouter free + `llm_fallbacks`, not Ollama).

---

## Assumptions

*Authored without synchronous user Q&A; review before planning.*

- “Completely free to operate” means **no mandatory paid SaaS** (Serper, Exa, Tavily, OpenAI paid tier). A **free OpenRouter signup** and self-hosted CPU (indexer, Chroma, HTTP) are acceptable operating costs.
- The approved-host catalog will grow toward ~50 domains via **batch crawl jobs**; query-time live crawl remains **recovery only**.
- Trask automated tests stay **removed** until the RAG/compose contract stabilizes; release confidence uses **stack smoke + Holocron/Discord manual QA** for now.
- **`vendor/llm_fallbacks`** submodule stays the **source of truth** for free model ordering; refresh via `git submodule update --remote vendor/llm_fallbacks`.
- Discord `/ask` shares the same research contract as Holocron; formatting differs by surface profile only.

---

## Actors

- **A1. Modder / lore seeker:** Asks Holocron questions; needs cited, readable answers.
- **A2. Discord member:** Uses Trask slash commands; same evidence bar, tighter latency budget.
- **A3. Operator:** Seeds Chroma, runs `trask_live_stack.sh`, sets `OPENROUTER_API_KEY` (and optional LiteLLM proxy), monitors retrieve/compose diagnostics.
- **A4. Compose LLM (external):** Rewrites **only** from retrieved passages; never browses the open web in the product path.

---

## Key Flows

- **F1. Happy-path research**
  - **Trigger:** User submits a question on Holocron or Discord.
  - **Actors:** A1 or A2, A3 stack, A4
  - **Steps:** Indexer hybrid retrieve → passages returned with `index_miss=false` → sufficiency gate passes → LLM compose with inline `[n]` → Sources block aligned to citations → response within latency budget.
  - **Outcome:** Assistant-quality answer with ≥2 distinct `https://` citations when corpus supports it.
  - **Covered by:** R6, R8, R11

- **F2. Weak retrieve recovery**
  - **Trigger:** Retrieve returns empty or below-quality passages.
  - **Actors:** A3 stack
  - **Steps:** Bounded allowlisted live Crawl4AI crawl (cap ~5 URLs) → upsert to Chroma → re-retrieve → proceed to F1 or abstain if still insufficient.
  - **Outcome:** `live_crawl_passages` logged; no unbounded open-web loop.
  - **Covered by:** R1, R3

- **F3. Insufficient evidence (honest degrade)**
  - **Trigger:** After retrieve (+ optional recovery), sufficiency gate fails.
  - **Actors:** A4 (optional minimal template), A1/A2
  - **Steps:** Skip fluent LLM essay → return short explanation of what was missing and what to try (rephrase, wait for crawl, check allowlist).
  - **Outcome:** User sees partial/failed grounding status, not a confident wrong answer.
  - **Covered by:** R6

- **F4. LLM compose with fallbacks**
  - **Trigger:** Sufficiency passes; compose enabled.
  - **Actors:** A4, A3
  - **Steps:** Try primary model (`openrouter/free` or LiteLLM alias `trask-research`) → on rate limit/timeout, walk vendored free-model chain (Node and/or LiteLLM proxy) → sync Sources section to approved URLs.
  - **Outcome:** Compose succeeds without local GPU; operator can trace which model tier answered.
  - **Covered by:** R8, R12

---

## Requirements

**Corpus and crawl**

- R1. **Index-first authority:** Scheduled batch crawl of approved hosts is the primary corpus; query-time live crawl is recovery-only, allowlist-bound, and capped.
- R2. **Unified collection:** Discord-indexed content lands in the same Chroma collection as web sources when sync is enabled.

**Retrieval**

- R3. **Hybrid retrieve (CPU):** Dense embeddings plus sparse/BM25-style signal, fused (RRF); heading-aware markdown chunking at ingest; optional CPU rerank on top fused hits.
- R4. **Retrieve observability:** Expert queries should log `passages_count`, `index_miss`, and live-crawl recovery in research diagnostics.

**Grounding**

- R5. **Citation integrity:** Every `https://` citation in the answer maps to a retrieved passage for that query.
- R6. **Sufficiency gate before compose:** Call `hasSufficientPassagesForGrounding` (≥2 distinct allowlisted `https://` hosts + query-anchor overlap) before LLM compose; on fail → F3 honest degrade. `TRASK_QA_GROUNDING=1` allows 1-URL escape for QA seed only.
- R7. **No unverified snippets in grounded path:** DuckDuckGo (or similar) discovery is not primary evidence for compose; default off for grounded answers.

**Compose and LLM policy**

- R8. **Free cloud compose default:** With `OPENROUTER_API_KEY` and `TRASK_LLM_PROFILE=free`, use OpenRouter `:free` routing; fallback order from **`vendor/llm_fallbacks/configs/free_models_ids.txt`** when `TRASK_REWRITE_MODEL_FALLBACKS` is unset (`@openkotor/config`).
- R9. **LiteLLM ops path (recommended for production fallback depth):** Operators may run `scripts/trask_litellm_proxy.sh` with `TRASK_LITELLM_CONFIG` pointing at `vendor/llm_fallbacks/configs/litellm_config_free.yaml`; Holocron/Trask use `LITELLM_PROXY_URL` + alias `trask-research`.
- R10. **No local LLM requirement:** Ollama, llama.cpp, and other self-hosted inference are **not** product requirements for compose.
- R11. **Assistant output shape:** Conversational prose, inline `[n]`, Sources bibliography synced to cited URLs; temperature conservative for faithfulness.
- R12. **Rewrite attempts:** Enough model fallbacks and retries to survive free-tier rate limits (multi-model chain, not single-shot).

**Surfaces and ops**

- R13. **One API contract:** Holocron and Discord share the same research/compose pipeline; surface profiles affect formatting only.
- R14. **Local repro:** `bash scripts/trask_live_stack.sh` brings up indexer → retrieve worker → HTTP with documented env (including `OPENROUTER_API_KEY`).
- R15. **Deploy parity:** Public Holocron uses the same compose policy; HF/CPU deploy favors pre-baked Chroma + remote free LLM, not interactive live crawl + local 7B on CPU.

**Quality gates (when tests return)**

- R16. **Split eval:** Offline faithfulness + holocron e2e (`verification-queries.json`) + Discord smoke. **Interim gates:** `pnpm trask:faithfulness-eval`, `pnpm verify:trask-cli`, manual browser on :4010.

---

## Acceptance Examples

- AE1. **Covers R6, R10.** Given retrieve returns one URL and weak anchor match for a two-source-capable query, when compose runs, then the user gets an honest insufficient-evidence response—not a multi-citation essay.
- AE2. **Covers R8, R12.** Given `OPENROUTER_API_KEY` set and primary `:free` model rate-limited, when compose runs, then a subsequent model in the vendored fallback list is tried before failing.
- AE3. **Covers R1, R2.** Given empty Chroma hit for an allowlisted URL on an expert query, when live crawl recovery runs, then passages are upserted, re-retrieve returns `index_miss=false`, and compose may proceed if R6 passes.
- AE4. **Covers R5, R11.** Given compose succeeds, when the user opens Sources, then every `[n]` in the body appears in Sources with an approved `https://` URL from retrieved passages.

---

## Success Criteria

- Expert verification queries return **assistant-quality** prose with **≥2 distinct `https://` citations** when the batch corpus supports them, using **OpenRouter free (or LiteLLM proxy over the same catalog)**—not local LLM.
- Operators can explain any answer as: **which passages were retrieved → whether sufficiency passed → how compose cited them → which model tier responded**.
- `index_miss=false` on expert queries after batch crawl + seed; live crawl recovery is the exception, not the norm.
- Planning handoff: `ce-plan` can implement retrieval/grounding/LLM wiring **without inventing product behavior or LLM policy**.

---

## Scope Boundaries

- Mandatory Serper, Exa, Tavily, or Google PSE for live web search.
- Full platform migration (RAGFlow, Onyx, Khoj, Open WebUI as replacement backend).
- GPT-Researcher / vendored research-wizard as default path.
- Multi-hop “deep research” agents on Discord (latency budget ~90s).
- Local LLM (Ollama) as recommended or required compose backend.
- Restoring broad Trask test suites before contract stabilization.
- browser-use, llm-scraper, Firecrawl as Holocron/Discord answer pipeline.
- Vectorize cutover before Chroma-path quality is stable.

---

## Key Decisions

- **Stay on owned stack:** Incremental hardening beats replatform; the 2026 pattern is composable crawl/index/retrieve/compose, which this repo already matches.
- **LLM = OpenRouter free + `bolabaden/llm_fallbacks`:** Align `@openkotor/config`, optional LiteLLM proxy, and operator docs; reject local inference as the default story.
- **Ground before fluency:** Wire `hasSufficientPassagesForGrounding` (or equivalent) on the compose path before paying LLM latency.
- **Index-first, crawl-on-miss:** Batch catalog growth is the main quality lever; live crawl is bounded recovery.
- **Tests deferred:** Manual stack + UI QA until requirements stabilize.

---

## Dependencies / Assumptions

- Crawl4AI + FastEmbed + Chroma stack (`infra/trask-indexer`, retrieve worker, `scripts/trask_web_research.py`).
- `@openkotor/config` `loadSharedAiConfig` for model/profile/fallback resolution.
- `vendor/llm_fallbacks` submodule initialized and periodically updated.
- At least one of: `OPENROUTER_API_KEY` (direct) or LiteLLM proxy with provider keys in proxy env.

---

## Outstanding Questions

### Resolve Before Planning

*(none — product policy and stack direction are set in this doc)*

### Deferred to Planning

- [Affects R3][Technical] True BM25 vs Chroma sparse-only: smallest change that meets hybrid bar.
- [Affects R1][Technical] Batch crawl operator CLI shape and schedule (cron vs one-shot catalog job).
- [Affects R9][Technical] Default `TRASK_LITELLM_CONFIG` to minimal sample vs full `litellm_config_free.yaml` in `trask_litellm_proxy.sh`.
- [Affects R15][Needs research] HF supervisor + baked Chroma volume layout for public deploy.
- [Affects R7][Technical] Exact env flag to disable DDG in grounded path everywhere (Python gather vs Node).
