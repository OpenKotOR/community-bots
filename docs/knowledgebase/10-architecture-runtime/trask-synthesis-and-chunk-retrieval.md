---
title: Trask Synthesis And Chunk Retrieval
owner: trask-bot
status: active
lastUpdated: 2026-05-18
---

# Package roles

- [REPO] **`@openkotor/trask`** — `WebResearchClient`, headless `scripts/trask_web_research.py` (Crawl4AI + DDG) subprocess bridge, optional OpenAI-compatible rewrite passes (`web-research.ts`; `research-wizard.ts` re-exports deprecated `ResearchWizard*` aliases).
- [REPO] **`@openkotor/retrieval`** — `defaultSourceCatalog`, `FileChunkStore`, `ChunkSearchProvider`, `createChunkSearchProvider`, URL allowlist helpers (`traskApprovedResearchSources`, `isTraskApprovedBaseUrl`, …).

# `createWebResearchClient`

- [REPO] Factory in `packages/trask/src/web-research.ts`: `(config, aiConfig?, factoryOptions?)` where `factoryOptions.localSearchProvider` is typically `createChunkSearchProvider(INGEST_STATE_DIR, { discordGuildId })` from HTTP hosts.
- [REPO] Discord bot `/ask` passes **`options.localHits`** (merged imported chunks + live channel pagination) instead of relying on the factory alone.

# Community knowledge (Discord)

- [REPO] `packages/trask/src/community-knowledge.ts` maps `SearchHit[]` → `SourceDescriptor[]`, builds a **“Community context (lower authority…)”** digest, and merges Discord permalinks with web citations via `mergeCommunityAndWebSources`.
- [REPO] Holocron minimum web citation policy (`MIN_HOLOCRON_WEB_CITATIONS = 2`) applies only to **approved web archive** URLs; `https://discord.com/channels/...` permalinks are a separate lower-authority class.
- [REPO] When `localSearchProvider` is set and `localHits` are omitted, `answerQuestion` calls `search(query, 6)` and emits `gather` progress (“Searching imported server history…”).

# `ChunkSearchProvider` (`packages/retrieval`)

- [REPO] **`createChunkSearchProvider(stateDir, { discordGuildId? })`** wraps `FileChunkStore(stateDir)` + catalog search.
- [REPO] **`search`**: token overlap over **all** chunks except `local://`; **Discord** chunks resolve citation URLs to HTTPS permalinks when `guild:` tags or `discordGuildId` are present (`packages/retrieval/src/discord-permalink.ts`).

# `answerQuestion` (full Holocron / Discord `/ask`)

- [REPO] Applies **`applySourcePreferences`** when `options.sourcePreferences` is present.
- [REPO] Resolves community hits (`localHits` or `localSearchProvider`), then runs **`fetchResearchReport`** (`trask_web_research.py`) for approved web archives.
- [REPO] Rewrite stage (`rewriteForDiscord` when OpenAI-compatible key is set) receives web + community sources; community digest is appended to the user prompt.
- [REPO] **`approvedSources`** in the response = `ensureMinimumWebCitations(...)` **plus** Discord permalinks cited in the final answer text.
- [REPO] **Catch path**: user-facing error mentions bootstrap env vars; no silent local-only success without web when synthesis throws.

# `answerQuestionBrief` (proactive)

- [REPO] Uses **`buildCustomPromptBrief()`** (~900 word digest contract); **does not** take `WebResearchQueryOptions` / source weight overrides.
- [REPO] Always uses full **`this.approvedSources`** for `fetchResearchReport`.
- [REPO] Returns **`researchReport`** (report + optional local digest) for **`scoreResearchAlignment`** in proactive mode.

# Model listing

- [REPO] **`listModels()`** merges `DEFAULT_WEB_RESEARCH_MODELS` (`auto`) with `listHeadlessWebResearchModels`; on failure returns defaults only.

# Operator troubleshooting

- [trask-research-troubleshooting.md](../50-execution/trask-research-troubleshooting.md) — timeouts, Crawl4AI+DDG / empty report, `INGEST_STATE_DIR` layout and mismatches, proactive gates, lexical chunk search limits.

# Related

- [answer-pipeline.md](answer-pipeline.md) — surfaces using this client.
- [discord-history-ingestion.md](discord-history-ingestion.md) — where Discord chunks enter `FileChunkStore`.
- [trask-reindex-queue-contract.md](trask-reindex-queue-contract.md) — catalog `reindex-queue.json` + ingest-worker drain.
- [trask-research-troubleshooting.md](../50-execution/trask-research-troubleshooting.md) — operator symptom index.
- `packages/trask/src/community-knowledge.test.ts` — [REPO] community digest and web/discord source split.
- `packages/retrieval/src/discord-permalink.test.ts` — [REPO] permalink resolution from chunk tags.
