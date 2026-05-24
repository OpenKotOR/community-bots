---
title: "Trask Discord /ask defer SLA hardening"
date: 2026-05-24
last_refreshed: 2026-05-24
category: tooling-decisions
problem_type: reliability
component: trask-bot
module: trask
tags:
  - "trask"
  - "discord"
  - "slash-commands"
  - "interaction-sla"
applies_when: "Discord /ask shows 'The application did not respond' or policy checks delay acknowledgement"
---

## Context

Discord requires slash commands to be acknowledged within ~3 seconds. Trask `/ask` runs RAG research that can exceed that window, so the bot must `deferReply` immediately. Policy checks (guild/channel allowlists) must not run before defer or they can miss the SLA when the event loop is busy.

## Solution

1. **Early defer** — `ensureAskDeferred` in `apps/trask-bot/src/discord-ask-interaction.ts` runs at the top of `interactionCreate` for `/ask`, before `isAllowedGuild` / `isAllowedChannel`.
2. **Policy after defer** — Denials use `safeEditReply` instead of `reply`.
3. **Stale token handling** — Discord error code `10062` is caught; work is skipped with a log (no unhandled throw).
4. **Ephemeral fallback** — If public defer fails, retry `deferReply({ ephemeral: true })`.
5. **Always-on process** — Bot must stay connected (`pnpm dev:trask` or `infra/trask-bot-stack` systemd); otherwise Discord shows timeout regardless of defer logic.
6. **Channel allowlist** — `node scripts/trask_discord_channel_verify.mjs` lists guild channels to confirm `TRASK_APPROVED_CHANNEL_IDS` snowflakes.

## Verification

```bash
node --test apps/trask-bot/dist/discord-ask-interaction.test.js
pnpm trask:stack:health
pnpm verify:trask-discord   # when TRASK_DISCORD_BOT_TOKEN + LLM + indexer up
```

## Related

- `docs/plans/2026-05-19-002-fix-trask-discord-ask-respond-plan.md` (closed)
- `docs/knowledgebase/10-architecture-runtime/trask-discord-slash-contract.md`
- `docs/trask-ops.md`
- `infra/trask-bot-stack/README.md`

## History

- 2026-05-24 — Documented closure after plan 002 implementation on `main`.
