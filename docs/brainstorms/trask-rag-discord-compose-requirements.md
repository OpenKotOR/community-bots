---
date: 2026-05-19
topic: trask-rag-discord-compose
status: active
supersedes-partially: trask-crawl4ai-rag-requirements.md
supersedes-plan-assumption: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md (compose path)
related: trask-crawl4ai-rag-requirements.md, STRATEGY.md
---

# Trask / Holocron — Vector RAG, Crawl4AI Corpus, Discord Index, Question-Last Compose

## Summary

Unify live answers around **retrieve → quote-backed claims → compose**, using the same CPU embedding index for **Crawl4AI web corpus** and **Discord channel history**. Stop treating scraped markdown digests as something to freely rewrite into absolutes. The model must compose only from retrieved passages, and the **user’s question must be the last content the composer sees** before generating the reply.

---

## Problem Frame

Holocron and Discord users ask toolchain questions where a wrong absolute (“always install X”, “files go in Y”) wastes hours. Remaining failure modes:

1. **Index miss → DuckDuckGo** snippets still become compose input when Chroma returns nothing (`scripts/trask_web_research.py`).
2. **Lexical local digest** (`searchLocalKnowledge` / `ChunkSearchProvider`) is merged into the report before compose — not the same as vector passages.
3. **`rewriteForDiscord`** still runs when grounded compose fails, paraphrasing the digest into confident prose.

**Partially landed (2026-05-19):** Chroma `POST /retrieve`, structured `passages`, default-on grounded compose with **question-last** prompts, Discord export→Chroma via `scripts/trask_discord_sync.py` when `TRASK_DISCORD_SYNC_INTERVAL_MS` > 0. **Gap:** sync defaults off; manual export + `import-discord-export` remains a valid legacy path for `FileChunkStore` only.

---

## Assumptions

- **Discord index scope:** all channels the bot can read in allowed guilds, minus **`TRASK_DISCORD_CHANNEL_BLACKLIST`** (implemented in `packages/config`). Proactive/approved lists gate *who may trigger answers*, not which channels are indexed.
- **`TRASK_DISCORD_SYNC_INTERVAL_MS=0`** (default): no automatic Discord→Chroma sync; operators must run `scripts/trask_discord_sync.py` or enable the interval on the bot.
- **Query-time retrieve authority:** `scripts/trask_web_research.py` + indexer HTTP; Node owns claim extract, compose, and citation alignment.

---

## Actors

- **A1. Holocron user** — needs cited, passage-grounded answers on approved web hosts.
- **A2. Discord `/ask` user** — same evidence bar, shorter replies.
- **A3. Operator** — runs crawl/reindex, monitors index health and Discord freshness.
- **A4. Indexer worker** — Crawl4AI fetch, chunk, embed (FastEmbed CPU), upsert Chroma.
- **A5. Trask runtime (Node)** — hybrid retrieve orchestration, claim extraction, compose, citation alignment.

---

## Key Flows

### F1 — Continuous corpus (web + Discord)

1. Approved catalog seeds are crawled with **Crawl4AI** (`infra/trask-indexer`) on a schedule or queue drain.
2. Discord: **automatic** export/index job reads messages from configured channels (not manual CLI per question).
3. Chunks get stable ids, metadata (`url`, `host`, `source_id`, `authority`, `channel_id`, `message_ids`, `content_hash`).
4. Same embedding model for ingest and query (`embed_texts` / `embed_query`).

### F2 — Question answering (retrieve-first)

1. User submits question (Holocron or Discord).
2. **Embed query** → hybrid retrieve (vector + optional lexical) over **one unified index**, allowlist-filtered.
3. **Deferred:** bounded live Crawl4AI fetch on weak recall (see crawl plan); v1 miss path must not invent steps via DDG digest rewrite.
4. Build **evidence pack**: ranked passages with verbatim quotes (no narrative report required for compose).
5. **Extract claims** (temp 0): each claim must include a supporting quote present in a passage.
6. **Compose** (temp 0): bullets + `[n]` citations; Sources lists **only cited** URLs.
7. **Prompt order (mandatory):** system rules → retrieved passages → extracted claims → allowed source list → **user question last**.
8. If fewer than two independent supporting web passages (existing Holocron contract) → abstain or source-only guidance — never fabricate steps.

### F3 — Discord at query time

1. Same retrieve path includes `authority: discord` passages when semantically relevant.
2. Discord passages may inform the answer body but **public Holocron citations remain `https://` on approved hosts** unless product explicitly expands citation policy later.

---

## Requirements

### Retrieval and index

- **R-1** Query path must use **vector retrieval** (Chroma + FastEmbed) as the primary evidence source for both web and Discord chunks.
- **R-2** When **zero vector passages** after allowlist filter: **abstain or source-only** — do not feed DuckDuckGo snippets into compose or `rewriteForDiscord`. DDG may remain operator-only bootstrap until index is seeded.
- **R-3** **Deferred:** demote or remove `searchLocalKnowledge` merge from compose path unless chunks are ingested into Chroma.
- **R-4** **Deferred:** Crawl4AI BM25/pruning filters at ingest (plain markdown chunking is v1).

### Discord automation

- **R-5** Trask must **automatically index** Discord messages from **every channel the bot can read** in allowed guilds, without manual export CLI before each `/ask`.
- **R-6** Discord chunks must be searchable via the **same retrieve API** as web (`POST /retrieve` or successor), tagged with `authority=discord`.
- **R-7** Operators configure a **channel blacklist** (env var, comma-separated channel IDs) to exclude sensitive or noisy channels from indexing; default is index-all-readable.
- **R-8** Respect allowed guilds, privileged intents, Discord rate limits, and redaction of invites/secrets in export paths.

### Compose and grounding

- **R-9** Default answer path must be **extractive compose** (`TRASK_GROUNDED_COMPOSE` on by default once stable), not freeform rewrite of a research report.
- **R-10** **Question-last prompting:** the final user-role message (or final block before generation) must be the **verbatim user question**; evidence and instructions precede it.
- **R-11** Composer may not introduce facts, paths, or install steps **not supported by an extracted quote** in the evidence pack.
- **R-12** When evidence conflicts, surface a **Caveats** line — do not pick one source silently.
- **R-13** Remove or gate `rewriteForDiscord(enrichedReport)` except when explicitly in degraded/source-only modes.

### Contracts unchanged

- **R-14** Holocron e2e: substantive answer, no stuck Thinking, **≥2 distinct `https://` citations** on approved hosts (existing contract).
- **R-15** No `local://` or `discord://` URLs in public Holocron **Sources** panel (existing policy).

---

## Acceptance Examples

**AE-1 (question-last)**  
Covers: R-10, R-11  
When the user asks “Where are KotOR save games on Windows?”, the compose prompt ends with `Question: Where are KotOR save games on Windows?` after all passage and claim blocks. The answer’s factual bullets map to quotes in the evidence pack.

**AE-2 (no digest absolutes)**  
Covers: R-9, R-13  
When the indexer returns three passages that only mention “save folder” without a path, the system responds with uncertainty or source links — not “Save games are always in …” invented by rewrite.

**AE-3 (Discord retrieve)**  
Covers: R-5, R-6, R-7  
When a toolchain answer was discussed in a non-blacklisted channel within the indexed window, retrieve returns a `discord://…` passage that influences the claim extractor even if web passages are thin. Blacklisted channels never appear in the index.

**AE-4 (Crawl4AI corpus)**  
Covers: R-1  
When Deadly Stream is reindexed, new posts appear as embedded chunks; a Holocron question about a modding tool retrieves those chunks without a DuckDuckGo search.

**AE-5 (index miss)**  
Covers: R-2  
When Chroma returns no passages, the user sees abstention or approved source links — not confident bullets sourced only from DuckDuckGo snippets.

**AE-6 (1 web + discord)**  
Covers: R-14, F3  
When retrieve yields one `https://` claim and one `discord://` passage, Holocron shows source-only or abstain — not a full compose pass that fails e2e citation count.

---

## Success Criteria

1. Golden five Holocron queries pass with **quote-backed** answers (manual or automated rubric: no unsupported absolutes).
2. Retrieve latency p95 within existing `TRASK_RESEARCH_TIMEOUT_MS` budget for Discord + web combined.
3. Discord index lag **≤ 24h** for approved channels (operator-visible freshness metric).
4. `TRASK_GROUNDED_COMPOSE` default-on: **&lt;10%** of answers use legacy rewrite fallback in eval set.

---

## Scope Boundaries

### In scope

- Unified Chroma retrieve for web + Discord
- Automatic Discord indexing for configured channels
- Question-last compose contract
- Default-on grounded compose; demote digest rewrite

### Deferred for later

- Cross-encoder rerank on CPU
- Optional small local LLM on VPS for fluency-only polish after extractive draft
- Citing `discord://` in public Holocron UI

### Outside this product’s identity

- Open-web search beyond allowlisted hosts
- Treating Discord gossip as ground truth without web corroboration for controversial claims
- Replacing human moderation of approved channel lists

---

## Key Decisions

| Decision | Choice |
|----------|--------|
| Primary evidence | Vector passages (Crawl4AI corpus + Discord index), not research-report rewrite |
| Web fetch | Crawl4AI background index + bounded live crawl on miss |
| Discord | Index all readable channels; `TRASK_DISCORD_CHANNEL_BLACKLIST` excludes noise/sensitive rooms |
| Compose | Extractive, question-last, temp 0 |
| Fallback | Abstain / source-only — not confident paraphrase |

---

## Dependencies / Assumptions

- `infra/trask-indexer` remains the embedding + Chroma authority.
- Crawl4AI `AsyncWebCrawler` + `DefaultMarkdownGenerator` (+ optional BM25/Pruning filters) per current docs.
- Discord bot retains Message Content intent for indexed channels.
- OpenAI-compatible key still used for **claim extract + compose only**, not retrieval embeddings.

---

## Outstanding Questions

1. Should Discord passages ever appear as visible citations in Discord `/ask` replies (plain URLs only today)?
2. Single Chroma collection vs separate `web` / `discord` collections merged at retrieve?
3. ~~Exact env name for blacklist~~ — **Resolved:** `TRASK_DISCORD_CHANNEL_BLACKLIST` in `packages/config`.

---

## References

- Existing: `docs/brainstorms/trask-crawl4ai-rag-requirements.md`
- Runtime: `packages/trask/src/research-wizard.ts`, `packages/trask/src/grounded-evidence.ts`
- Indexer: `infra/trask-indexer/`, `scripts/trask_web_research.py`
- Discord Chroma sync: `scripts/trask_discord_sync.py`, `infra/trask-indexer/trask_indexer/discord_index.py`, `apps/trask-bot/src/discord-index-sync.ts`
- Legacy FileChunkStore ingest: `apps/ingest-worker/src/discord-export-import.ts`, `scripts/export_discord_server.py`
