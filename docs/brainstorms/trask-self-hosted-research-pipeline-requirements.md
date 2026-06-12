---
date: 2026-06-11
topic: trask-replacement-first-research-agent-pipeline
status: active
origin: user-request-free-self-host-best-practice-research
---

# Trask / Holocron replacement-first research agent pipeline

## Summary

Trask and Holocron now follow a **replacement-first, citation-first** contract: maintain an ahead-of-time evidence cache over approved web sources and DiscordChatExporter archives, retrieve citation-ready evidence quickly, authorize destinations at answer time, and compose in character only when the evidence is sufficient. Existing Crawl4AI, Chroma, FastEmbed, Python gather, retrieve Worker, and Node compose paths are implementation candidates, not product commitments.

Inference is **Hugging Face first, Cloudflare second**, with deterministic extractive fallback. `OPENAI_API_KEY` and OpenRouter are not primary validation requirements. Free-first operation means the system must degrade honestly under quota, cold-start, or provider outage instead of hallucinating or waiting outside the 10-30 second answer budget.

---

## Problem Frame

Modders and Discord users ask practical KotOR questions and expect answers that read like a helpful assistant: clear prose, inline citations, and a Sources list they can verify. When retrieval is weak or compose runs without enough evidence, answers degrade into digest bullets, markdown leaks, or fluent guesses— which erodes trust faster than an honest “not enough sources.”

The old stack exposed useful failure modes: thin retrieve, citations that were not always destination-authorized, provider assumptions that pointed operators at OpenAI/OpenRouter, and limited agent-readable operations. Replacement work should preserve the useful product shape while allowing any internal component to be swapped if it improves citation fidelity, deletion support, latency, free-tier operations, or operator simplicity.

---

## Assumptions

*Authored without synchronous user Q&A; review before planning.*

- “Completely free to operate” means **no mandatory paid SaaS** and no required `OPENAI_API_KEY`. Hugging Face and Cloudflare free/account paths are acceptable, but quotas must trigger deterministic cited fallback.
- The approved web catalog and Discord archives are refreshed **ahead of time** on configurable cadences. Query-time live crawl is not a dependency for normal answers.
- DiscordChatExporter archives under each export target's `output_dir` (registry default `data/trask/discord-export-targets.json`) are operator-owned inputs; enabled/disabled targets and refresh state must be inspectable.
- Discord `/ask`, proactive replies, Holocron, and agent tools share the same evidence/citation contract. Surface profiles affect authorization and formatting only.
- Every operator-facing action should have an agent-readable equivalent or an explicit safety exception with read-only/dry-run parity.

---

## Actors

- **A1. Modder / lore seeker:** Asks Holocron questions; needs cited, readable answers.
- **A2. Discord member:** Uses Trask slash commands; same evidence bar, tighter latency budget.
- **A3. Operator:** Approves sources, configures refresh cadences, runs stack health, inspects evidence/freshness/provider traces, and purges Discord evidence.
- **A4. Agent/operator assistant:** Uses discoverable Trask actions to dry-run refreshes, inspect evidence packs, explain proactive decisions, and prepare safe purge/refresh requests.
- **A5. Compose/classification provider:** Hugging Face first, Cloudflare second; receives only minimized approved evidence and never browses the open web in the product path.

---

## Key Flows

- **F1. Happy-path research**
  - **Trigger:** User submits a question on Holocron or Discord.
  - **Actors:** A1 or A2, A3 stack, A4
  - **Steps:** Retrieval boundary returns an evidence pack → citation and destination authorization gate passes → Hugging Face compose, Cloudflare fallback, or deterministic extractive compose → response within latency budget.
  - **Outcome:** In-character answer with exact web or authorized Discord citations when corpus supports it.
  - **Covered by:** R6, R8, R11

- **F2. Scheduled freshness recovery**
  - **Trigger:** Retrieve returns empty or below-quality passages **and** live crawl is explicitly enabled (`TRASK_WEB_RESEARCH_LIVE_CRAWL=1`). On the default served stack live crawl is **off** (R1a; see runbook **REQ-B**) so this flow does not run; the query honest-degrades (F3) instead.
  - **Actors:** A3 stack, A4
  - **Steps:** Agent/operator inspects freshness → dry-runs source refresh → triggers approved refresh or reconciliation job → stale/deleted evidence is tombstoned → later queries use fresh evidence.
  - **Outcome:** No unbounded query-time crawling; freshness gaps are solved by corpus jobs and visible traces.
  - **Covered by:** R1, R1a, R3

- **F3. Insufficient evidence (honest degrade)**
  - **Trigger:** After retrieve (+ optional recovery), sufficiency gate fails.
  - **Actors:** A4 (optional minimal template), A1/A2
  - **Steps:** Skip fluent LLM essay → return short explanation of what was missing and what to try (rephrase, wait for crawl, check allowlist).
  - **Outcome:** User sees partial/failed grounding status, not a confident wrong answer.
  - **Covered by:** R6

- **F4. Provider chain with fallback**
  - **Trigger:** Sufficiency passes; compose enabled.
  - **Actors:** A4, A3
  - **Steps:** Try Hugging Face provider/model → on rate limit/timeout, try Cloudflare provider/model within the remaining budget → on hosted failure, return deterministic cited extractive answer or insufficient-evidence response.
  - **Outcome:** Compose/classification/rerank do not require OpenAI/OpenRouter credentials; operator can trace which provider tier answered.
  - **Covered by:** R8, R12

---

## Requirements

**Product requirement crosswalk** (operator runbook IDs; see [trask-indexed-stack-runbook.md](../knowledgebase/50-execution/trask-indexed-stack-runbook.md)):

| ID | Maps to | Summary |
|----|---------|---------|
| **REQ-A** | R1a | Weekly cached-corpus refresh (Cloudflare cron Worker or GitHub Actions → `POST /reindex`) |
| **REQ-B** | R1, R1a | Query-time answers from maintained evidence cache; live crawl off by default |
| **REQ-C** | R4a | Soft ≤30s research budget (`TRASK_RESEARCH_BUDGET_MS`) |

**Corpus and crawl**

- R1. **Index-first authority:** Scheduled ingestion of approved web hosts and DiscordChatExporter archives is the primary corpus; query-time live crawl is not required for normal answers.
- R1a. **Weekly scheduled refresh (implemented):** The approved catalog is re-crawled on a **weekly** cadence (Mondays 06:00 UTC). A **Cloudflare cron Worker** (`infra/trask-reindex-scheduler`, `crons = ["0 6 * * 1"]`) — or the credential-free **GitHub Actions** schedule (`.github/workflows/trask-weekly-reindex.yml`) — POSTs the token-guarded `POST /reindex` trigger on the indexer, which runs `crawl-seeds` in the background. Chroma stays on the indexer host (a Worker/Durable Object cannot host an ANN index); "in Cloudflare" means **scheduling**, not storage. Per-query live crawl is **off by default** on the served stack so answers come from the cached weekly corpus.
- R2. **Unified evidence records:** Web and Discord content land behind the same retrieval boundary with source type, URL/jump-link locator, freshness, content hash, deletion state, and authorization hints.

**Retrieval**

- R3. **Hybrid retrieve:** Dense embeddings plus BM25-style lexical rank, fused with RRF and optional small rerank when it fits the latency budget. The store may be Chroma, Qdrant, LanceDB, sqlite-vec, Cloudflare Vectorize/R2/D1, or a replacement that satisfies deletion and citation materialization.
- R4. **Retrieve observability:** Expert queries should log evidence count, index miss, retrieval mode, freshness, rerank status, citation URLs, and exclusion reasons.
- R4a. **Bounded latency (≤30s, implemented):** A soft end-to-end research budget (`TRASK_RESEARCH_BUDGET_MS`, default **30000**) clamps the gather subprocess and each compose LLM call, and bounds grounded-compose by a deadline. Cached-index answers return well under 30s; if a free-LLM compose stalls past the budget it falls back to the instant grounded template (R6/F3 honest-degrade) rather than exceeding the budget. Legacy `TRASK_RESEARCH_TIMEOUT_MS` (900s) is a parent subprocess ceiling, not the product SLA.

**Grounding**

- R5. **Citation integrity:** Every `https://` citation in the answer maps to a retrieved passage for that query.
- R6. **Sufficiency gate before compose:** Call `hasSufficientPassagesForGrounding` (≥2 distinct allowlisted `https://` hosts + query-anchor overlap) before LLM compose; on fail → F3 honest degrade. `TRASK_QA_GROUNDING=1` allows 1-URL escape for QA seed only.
- R7. **No unverified snippets in grounded path:** DuckDuckGo (or similar) discovery is not primary evidence for compose; default off for grounded answers.

**Compose and LLM policy**

- R8. **Hugging Face-first provider default:** With `HF_TOKEN`, use Hugging Face-hosted/OpenAI-compatible endpoints for answer generation, proactive classification, and optional rerank.
- R9. **Cloudflare HA fallback:** With Cloudflare AI Gateway/Workers AI configuration, try Cloudflare after Hugging Face within the remaining research budget.
- R10. **Deterministic fallback:** When hosted providers fail or are unconfigured, return a cited extractive answer if evidence is sufficient; otherwise abstain honestly.
- R11. **In-character output shape:** Conversational prose from Trask, messenger of the Colossal Holocron, with inline `[n]` and a Sources section synced to exact citations; character never outranks evidence.
- R12. **Provider traces:** Attempts, timeouts, fallbacks, and deterministic fallback reasons are logged without secrets or full private Discord passages.

**Surfaces and ops**

- R13. **One evidence contract:** Holocron, Discord `/ask`, proactive replies, and agent tools share the same evidence-pack/citation-gate pipeline; surface profiles affect authorization and formatting. On the **`discord` surface**, Discord jump-link citations require destination authorization context (`destinationGuildId`, `destinationChannelId`, and/or `authorizedDiscordChannelIds`); missing context **fail-closed** (citation dropped).
- R14. **Agent-native ops parity:** Source listing, freshness inspection, dry-run refresh, allowed refresh, evidence inspection, proactive decision explain, purge, provider health, and capability discovery are machine-readable.
- R15. **Local repro:** The live-stack script or its replacement brings up the selected retrieval boundary and HTTP surface with documented HF/Cloudflare/deterministic fallback env.

**Quality gates (when tests return)**

- R16. **Split eval:** Offline faithfulness + holocron e2e (`verification-queries.json`) + Discord smoke. **Interim gates:** `pnpm trask:faithfulness-eval`, `pnpm verify:trask-cli`, manual browser on :4010.

---

## Acceptance Examples

- AE1. **Covers R6, R10.** Given retrieve returns one URL and weak anchor match for a two-source-capable query, when compose runs, then the user gets an honest insufficient-evidence response—not a multi-citation essay.
- AE2. **Covers R8-R10, R12.** Given `HF_TOKEN` is set and the primary Hugging Face call times out, when compose runs, then Cloudflare is tried if configured, otherwise deterministic cited fallback is returned.
- AE3. **Covers R1, R2 (opt-in).** Given empty Chroma hit for an allowlisted URL on an expert query **and live crawl enabled** (`TRASK_WEB_RESEARCH_LIVE_CRAWL=1`), when live crawl recovery runs, then passages are upserted, re-retrieve returns `index_miss=false`, and compose may proceed if R6 passes. On the default served stack (live crawl off) the same gap honest-degrades (F3) and is closed by the next weekly refresh (R1a).
- AE4. **Covers R5, R11.** Given compose succeeds, when the user opens Sources, then every `[n]` in the body appears in Sources with an approved `https://` URL from retrieved passages.

---

## Success Criteria

- Expert verification queries return in-character prose with exact citations when the corpus supports them, using Hugging Face first and Cloudflare second when configured.
- Operators can explain any answer as: **which passages were retrieved → whether sufficiency passed → how compose cited them → which model tier responded**.
- `index_miss=false` on expert queries after the weekly batch crawl + seed; per-query live crawl is **off by default** on the served stack (opt-in recovery only), so the cached corpus must carry expert coverage.
- Planning handoff: `ce-plan` can implement retrieval/grounding/LLM wiring **without inventing product behavior or LLM policy**.

---

## Scope Boundaries

- Mandatory Serper, Exa, Tavily, OpenAI, or paid search/model APIs for normal operation.
- Full product migration to RAGFlow, Onyx, Khoj, or Open WebUI as a user-facing replacement backend without preserving the evidence/citation contract.
- GPT-Researcher / vendored research-wizard as default path.
- Multi-hop “deep research” agents on Discord (latency budget ~90s).
- Local LLM (Ollama) as recommended or required compose backend.
- Restoring broad Trask test suites before contract stabilization.
- browser-use, llm-scraper, Firecrawl as Holocron/Discord answer pipeline.
- OpenRouter or `OPENAI_API_KEY` as required validation credentials.

---

## Key Decisions

- **Replacement-first internals:** Current tools are evidence, not constraints. Keep any component only when it wins the replacement gates.
- **Provider chain = Hugging Face → Cloudflare → deterministic fallback:** `OPENAI_API_KEY` is not part of the primary validation path.
- **Ground before fluency:** Wire `hasSufficientPassagesForGrounding` (or equivalent) on the compose path before paying LLM latency.
- **Index-first, crawl-on-miss:** Batch catalog growth is the main quality lever; live crawl is bounded recovery.
- **Tests deferred:** Manual stack + UI QA until requirements stabilize.

---

## Dependencies / Assumptions

- Selected corpus builder and retrieval boundary (`infra/trask-indexer`, retrieve worker, `scripts/trask_web_research.py`, or replacements).
- `@openkotor/config` `loadSharedAiConfig` for model/profile/fallback resolution.
- `HF_TOKEN` for primary hosted inference and optional Cloudflare AI Gateway/Workers AI credentials for HA.
- DiscordChatExporter archives are operator-owned inputs under each target's `output_dir`; target registry defaults to `data/trask/discord-export-targets.json` (`TRASK_DISCORD_EXPORT_TARGETS_CONFIG` override).

---

## Outstanding Questions

### Resolve Before Planning

*(none — product policy and stack direction are set in this doc)*

### Deferred to Planning

- [Affects R3][Technical] True BM25 vs Chroma sparse-only: smallest change that meets hybrid bar.
- ~~[Affects R1][Technical] Batch crawl operator CLI shape and schedule (cron vs one-shot catalog job).~~ **Resolved (R1a):** weekly Cloudflare cron Worker + GitHub Actions schedule both call the token-guarded indexer `POST /reindex`.
- [Affects R9][Technical] Default `TRASK_LITELLM_CONFIG` to minimal sample vs full `litellm_config_free.yaml` in `trask_litellm_proxy.sh`.
- [Affects R15][Needs research] HF supervisor + baked Chroma volume layout for public deploy.
- [Affects R7][Technical] Exact env flag to disable DDG in grounded path everywhere (Python gather vs Node).
