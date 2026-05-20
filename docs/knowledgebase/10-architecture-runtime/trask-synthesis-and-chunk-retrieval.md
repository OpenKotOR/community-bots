---
title: Trask Synthesis And Chunk Retrieval
owner: trask-bot
status: active
lastUpdated: 2026-05-19
---

# Package roles

- [REPO] **`@openkotor/trask`** — `ResearchWizardClient`, `scripts/trask_web_research.py` subprocess bridge, optional OpenAI-compatible rewrite passes (`research-wizard.ts`).
- [REPO] **`@openkotor/retrieval`** — `defaultSourceCatalog`, `FileChunkStore`, `ChunkSearchProvider`, `createChunkSearchProvider`, URL allowlist helpers (`traskApprovedResearchSources`, `isTraskApprovedBaseUrl`, …).

# `createResearchWizardClient`

- [REPO] Factory in `packages/trask/src/research-wizard.ts`: `(config, aiConfig?, localSearchProvider?)` → client wired to **`traskApprovedResearchSources`** for live web research plus optional **`localSearchProvider`** (typically `createChunkSearchProvider(INGEST_STATE_DIR)` from hosts).

# Local knowledge (`SearchProvider`)

- [REPO] When `localSearchProvider` is set, **`searchLocalKnowledge`** runs `search(query, 4)`, drops hits whose URL passes **`isTraskApprovedBaseUrl`** (avoids double-counting catalog home URLs), and builds a **“Local Knowledge Context (lower authority…)”** digest string plus `SourceDescriptor[]` from `searchHitToSource`.
- [REPO] On search throw, digest/sources are empty (silent degrade).

# `ChunkSearchProvider` (`packages/retrieval`)

- [REPO] **`createChunkSearchProvider(stateDir)`** wraps `FileChunkStore(stateDir)` + `StaticCatalogSearchProvider(defaultSourceCatalog, FileReindexQueueStore(stateDir))`.
- [REPO] **`search`**: token overlap scoring over **all** loaded chunks plus catalog search; **merges** chunk hits before catalog hits, dedupes by URL, sorts by score descending, returns up to **`limit`** (default **5** in `listSources` callers; local path uses **4**).

# `answerQuestion` (full Holocron / Discord `/ask`)

- [REPO] Applies **`applySourcePreferences`** to `traskApprovedResearchSources` when `options.sourcePreferences` is present.
- [REPO] Loads local digest via **`searchLocalKnowledge`**; emits **`onProgress`** `gather` when local hits exist. Local digest is appended to the web research report for passage extraction only — **`local://`** URLs are not emitted in public **Sources**.
- [REPO] **`fetchResearchReport`** → `runTraskWebResearch` with `allowed_url_prefixes` from approved sources, optional `model`, and custom prompt **`buildCustomPrompt()`**.
- [REPO] When **`TRASK_GROUNDED_COMPOSE=1`** and an OpenAI-compatible client is configured, **`tryGroundedCompose`** (`grounded-evidence.ts`) splits the enriched report into passages, extracts claims (LLM with heuristic fallback), and composes an answer with inline `[n]` citations. **`approvedSources`** are **`alignCitedSourcesToAnswer`** — only URLs cited in the body; no URL-padding to meet **`MIN_HOLOCRON_WEB_CITATIONS`**.
- [REPO] Otherwise: **`rewriteForDiscord`** when an LLM client exists, else **`fallbackDiscordRewrite`**; synthesis-failure reports may use **`sourceOnlyFallbackAnswer`**. Final **`approvedSources`** always pass through **`alignCitedSourcesToAnswer`** (except the grounded path, which already aligned).
- [REPO] Returns **`groundingStatus`** (`grounded` | `partial` | `failed`) via **`inferGroundingStatus`** for Holocron provenance UX and persistence.
- [REPO] **Catch path**: research/timeout errors return a user-visible failure string with empty sources (no fake citations).

# `answerQuestionBrief` (proactive)

- [REPO] Uses **`buildCustomPromptBrief()`** (~900 word digest contract); **does not** take `ResearchWizardQueryOptions` / source weight overrides.
- [REPO] Always uses full **`this.approvedSources`** for `fetchResearchReport`.
- [REPO] Returns **`researchReport`** (report + optional local digest) for **`scoreResearchAlignment`** in proactive mode.

# Model listing

- [REPO] **`listModels()`** returns `DEFAULT_RESEARCH_WIZARD_MODELS` (`auto` and configured rewrite ids).

# Operator troubleshooting

- [trask-research-troubleshooting.md](../50-execution/trask-research-troubleshooting.md) — timeouts, empty research report, `INGEST_STATE_DIR` layout and mismatches, proactive gates, lexical chunk search limits.

# Related

- [answer-pipeline.md](answer-pipeline.md) — surfaces using this client.
- [discord-history-ingestion.md](discord-history-ingestion.md) — where Discord chunks enter `FileChunkStore`.
- [trask-reindex-queue-contract.md](trask-reindex-queue-contract.md) — catalog `reindex-queue.json` + ingest-worker drain.
- [trask-research-troubleshooting.md](../50-execution/trask-research-troubleshooting.md) — operator symptom index.
- `packages/trask/src/local-knowledge.test.ts` — [REPO] merge/fallback behavior.
