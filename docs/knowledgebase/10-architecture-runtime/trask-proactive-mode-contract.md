---
title: Trask Proactive Mode Contract
owner: trask-bot
status: active
lastUpdated: 2026-05-18
---

# Enablement

- [REPO] `TRASK_PROACTIVE_ENABLED` and runtime prerequisites in `apps/trask-bot/src/main.ts`: needs **`OPENAI_API_KEY` or `OPENROUTER_API_KEY`**, and at least one channel id after resolving `TRASK_PROACTIVE_CHANNEL_IDS` or fallback **`TRASK_APPROVED_CHANNEL_IDS`**.
- [REPO] When active, the Discord client requests **`guildMessages`** and **`messageContent`** intents (`main.ts`).

# Registration

- [REPO] `registerTraskProactiveHandlers` in `apps/trask-bot/src/proactive-handler.ts`; if `createOpenAiClient` fails, logs warning and **does not** attach the listener.

# Channel and guild gates

- [REPO] Messages are processed only when `message.channelId` is in the allowlist (`Set` from `resolveProactiveChannelIds`).
- [REPO] When `TRASK_ALLOWED_GUILD_IDS` is non-empty, `message.guildId` must be listed; empty allowlist means all guilds.

# Ignored messages (`shouldIgnoreMessage`)

- [REPO] Ignores: bots, non-guild / non-textable channels, empty content, length outside **`TRASK_PROACTIVE_MIN_MESSAGE_LENGTH`–`TRASK_PROACTIVE_MAX_MESSAGE_LENGTH`**, content starting with **`/`** (slash commands).

# Debounce and competing traffic

- [REPO] Per-channel **`TRASK_PROACTIVE_DEBOUNCE_MS`** timer; latest pending message in that channel wins (replaces `pendingByChannel` entry and resets timer).
- [REPO] After debounce, refetches trigger message; if content changed vs pending, aborts.
- [REPO] Fetches up to **20** messages **after** the trigger; if another **non-bot** user posted content with length ≥ **`TRASK_PROACTIVE_COMPETING_MIN_LENGTH`**, skips reply (avoids dogpiling).

# Classifier and semantic gate

- [REPO] `classifyTraskProactiveMessage` with **`TRASK_PROACTIVE_CLASSIFIER_MODEL`**; requires `isQuestion` and `kotorRelevant` and `confidence ≥ TRASK_PROACTIVE_CLASSIFIER_MIN_CONFIDENCE`.
- [REPO] `webResearch.answerQuestionBrief` then `scoreResearchAlignment` using **`TRASK_PROACTIVE_SIMILARITY_THRESHOLD`** vs embedding model from shared AI config.

# Reply shape

- [REPO] `formatProactivePlainReply` with body cap `min(520, TRASK_PROACTIVE_MAX_REPLY_CHARS)` and **3** sources; final content capped at **`TRASK_PROACTIVE_MAX_REPLY_CHARS`**.
- [REPO] Plain `message.reply` with **`allowedMentions: { repliedUser: false, parse: [] }`**.

# Query log

- [REPO] When `queryRepository` is passed, appends a **`complete`** row with **new random** `queryId` and `threadId` per proactive reply (`proactive-handler.ts`).

# Cooldown

- [REPO] Per-author **`TRASK_PROACTIVE_USER_COOLDOWN_MS`** after a successful reply.

# Related

- [discord-privacy-and-source-authority.md](../40-operational-risk/discord-privacy-and-source-authority.md) — intent and data sensitivity.
- [trask-discord-slash-contract.md](trask-discord-slash-contract.md) — slash-only baseline when proactive is off.
- [trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md) — `answerQuestionBrief` and `scoreResearchAlignment` inputs.
- [trask-research-troubleshooting.md](../50-execution/trask-research-troubleshooting.md) — keys, timeouts, chunk paths.
