---
title: Trask Proactive Mode Contract
owner: trask-bot
status: active
lastUpdated: 2026-06-11
---

# Enablement

- [REPO] `TRASK_PROACTIVE_ENABLED` and runtime prerequisites in `apps/trask-bot/src/main.ts`: needs a **hosted inference provider** from `@openkotor/config` `loadSharedAiConfig` (**Hugging Face first** via `HF_TOKEN` / `HUGGINGFACE_TOKEN`, **Cloudflare second** when configured), and at least one channel id after resolving `TRASK_PROACTIVE_CHANNEL_IDS` or fallback **`TRASK_APPROVED_CHANNEL_IDS`**.
- [REPO] When active, the Discord client requests **`guildMessages`** and **`messageContent`** intents (`main.ts`).

# Registration

- [REPO] `registerTraskProactiveHandlers` in `apps/trask-bot/src/proactive-handler.ts`; if `createOpenAiClient` fails, logs warning and **does not** attach the listener.

# Channel and guild gates

- [REPO] Messages are processed only when `message.channelId` is in the allowlist (`Set` from `resolveProactiveChannelIds`).
- [REPO] When `TRASK_ALLOWED_GUILD_IDS` is non-empty, `message.guildId` must be listed; empty allowlist means all guilds.

# Ignored messages (`shouldIgnoreMessage`)

- [REPO] Ignores: bots, non-guild / non-textable channels, empty content, length outside **`TRASK_PROACTIVE_MIN_MESSAGE_LENGTH`–`TRASK_PROACTIVE_MAX_MESSAGE_LENGTH`**, content starting with **`/`** (slash commands).

# Debounce, supersession, and competing traffic

- [REPO] Per-channel **`TRASK_PROACTIVE_DEBOUNCE_MS`** timer; latest pending message in that channel wins (replaces `pendingByChannel` entry and resets timer).
- [REPO] Per-channel **generation counter** (`generationByChannel`): if a newer human message arrives before research completes or before send, the in-flight reply is **superseded** and dropped (audit log on skip).
- [REPO] After debounce, refetches trigger message; if content changed vs pending, aborts.
- [REPO] Fetches up to **20** messages **after** the trigger; if another **non-bot** user posted content with length ≥ **`TRASK_PROACTIVE_COMPETING_MIN_LENGTH`**, skips reply (avoids dogpiling). Re-checks competing traffic immediately before send.

# Classifier and semantic gate

- [REPO] `classifyTraskProactiveMessage` with **`TRASK_PROACTIVE_CLASSIFIER_MODEL`**; requires `isQuestion` and `kotorRelevant` and `confidence ≥ TRASK_PROACTIVE_CLASSIFIER_MIN_CONFIDENCE`.
- [REPO] `webResearch.answerQuestionBrief` then `scoreResearchAlignment` using **`TRASK_PROACTIVE_SIMILARITY_THRESHOLD`** vs embedding model from shared AI config (`createEmbeddingClient` in `packages/trask/src/proactive-llm.ts`).
- [REPO] When no embedding-capable provider is configured (e.g. Cloudflare chat-only without `TRASK_CLOUDFLARE_EMBEDDING_MODEL`), semantic gate **passes through** (`similarity = 1`) rather than blocking proactive replies.

# Reply shape

- [REPO] `formatDiscordAskDisplay` renders at most **2** cited lines for proactive replies; final content is prefixed with `Trask, quietly:` and capped at **`TRASK_PROACTIVE_MAX_REPLY_CHARS`**.
- [REPO] Plain `message.reply` uses **`allowedMentions: { repliedUser: false, parse: [] }`** and suppresses embeds/unfurls.

# Query log

- [REPO] When `queryRepository` is passed, appends a **`complete`** row with **new random** `queryId` and `threadId` per proactive reply (`proactive-handler.ts`).

# Cooldown

- [REPO] Per-author **`TRASK_PROACTIVE_USER_COOLDOWN_MS`** after a successful reply.

# Related

- [discord-privacy-and-source-authority.md](../40-operational-risk/discord-privacy-and-source-authority.md) — intent and data sensitivity.
- [trask-discord-slash-contract.md](trask-discord-slash-contract.md) — slash-only baseline when proactive is off.
- [trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md) — `answerQuestionBrief` and `scoreResearchAlignment` inputs.
- [trask-research-troubleshooting.md](../50-execution/trask-research-troubleshooting.md) — keys, timeouts, chunk paths.
- [trask-research-agent-2026-standards.md](trask-research-agent-2026-standards.md) — HF-first / Cloudflare-second provider policy.
