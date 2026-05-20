---
title: Trask Discord Slash Contract
owner: trask-bot
status: active
lastUpdated: 2026-05-19
---

# Commands

- [REPO] Slash definitions live in `apps/trask-bot/src/main.ts` (`SlashCommandBuilder`).

## `/ask`

- [REPO] Options: `query` (required string, **max 200** chars, autocomplete), `thread` (optional string, **max 36** chars — Holocron thread UUID from `?thread=`).
- [REPO] Interaction flow: `ensureAskDeferred` in `apps/trask-bot/src/discord-ask-interaction.ts` runs **immediately** when `/ask` is received (before guild/channel policy checks); public `deferReply` first, ephemeral fallback on defer failure; policy denials use `editReply` after defer; stale interactions (Discord `10062`) are skipped with a log.
- [REPO] **Thread id behavior:** if `thread` is missing or **not** a valid UUID (`isTraskThreadId`), the bot generates a **new random UUID** for `threadId` (unlike Holocron HTTP, which returns **422** for bad UUIDs — see [trask-http-ask-contract.md](trask-http-ask-contract.md)).
- [REPO] Research timeout for Discord is **`min(TRASK_RESEARCHWIZARD_TIMEOUT_MS, 90_000)`** ms (`DISCORD_ASK_RESPONSE_SLA_MS`); exceeding SLA records a failed query and edits reply with a timeout message.
- [REPO] Successful answers use `buildResearchEmbed` with `formatDiscordAskDisplay` (`packages/trask/src/discord-reply-format.ts`): **≤5** non-empty lines in the embed description, inline `[n](https://…)` citations only — **no** separate Sources embed fields. Research uses `answerQuestionBrief` (shorter compose than Holocron HTTP). Description is truncated to **4000** chars for Discord limits.
- [REPO] Each `/ask` appends a row to `JsonTraskQueryRepository` (`TRASK_QUERY_DATA_DIR` / `trask-queries.json`) with `queryId`, `threadId`, `userId`, status, answer/sources/error.
- [REPO] When `TRASK_HOLOCRON_PUBLIC_URL` is set, embeds add a **Holocron** field linking `?thread=<threadId>` (success and error paths).

## `/sources`

- [REPO] **Manage Guild** permission required (`setDefaultMemberPermissions(ManageGuild)`).
- [REPO] Optional `kind` filter: `website`, `github`, or `discord`.
- [REPO] Replies immediately (no defer) with up to **10** sources in the embed.

## `/queue-reindex`

- [REPO] **Manage Guild** permission required.
- [REPO] Optional `source` choice from `defaultSourceCatalog`; blank queues **all** catalog sources via `searchProvider.queueReindex`.
- [REPO] Ephemeral success reply; actual indexing is performed by **ingest-worker** draining the queue (see [ingest-worker-cli-runbook.md](../50-execution/ingest-worker-cli-runbook.md), [trask-reindex-queue-contract.md](trask-reindex-queue-contract.md)).

# Autocomplete (`/ask` `query`)

- [REPO] Recent queries per user (deduped, case-insensitive), max **60** stored, max **25** choices returned, values clipped to **100** chars (`AUTOCOMPLETE_*` constants in `main.ts`).

# Intents (summary)

- [REPO] Proactive mode adds `guildMessages` + `messageContent` when enabled and prerequisites are met ([trask-proactive-mode-contract.md](trask-proactive-mode-contract.md)).
- [REPO] Welcome adds `guildMembers` when welcome config is present (`welcome-handler`).

# Related

- [trask-http-ask-contract.md](trask-http-ask-contract.md) — Holocron REST parity differences.
- [trask-embedded-holocron-web.md](trask-embedded-holocron-web.md) — Holocron served from the bot process.
- [trask-proactive-mode-contract.md](trask-proactive-mode-contract.md) — debounce, classifier, and gates.
- [answer-pipeline.md](answer-pipeline.md) — synthesis and chunk search.
- [trask-reindex-queue-contract.md](trask-reindex-queue-contract.md) — `reindex-queue.json`, lock, drain worker.
- [trask-persona-and-welcome-style.md](../30-product-ux/trask-persona-and-welcome-style.md) — welcome copy env.
