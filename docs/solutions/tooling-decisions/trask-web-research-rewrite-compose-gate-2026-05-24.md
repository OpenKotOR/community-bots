---
title: "Trask WebResearchClient rewrite compose gate (R-13 parity)"
date: 2026-05-24
last_refreshed: 2026-05-24
category: tooling-decisions
problem_type: reliability
component: trask
module: trask
tags:
  - "trask"
  - "compose"
  - "grounded"
  - "pazaak-bot"
  - "web-research"
applies_when: "Legacy WebResearchClient (pazaak embedded Trask) paraphrases digests while Holocron uses grounded compose"
---

## Context

Two Trask answer clients existed with divergent compose policy:

- **`ResearchWizardClient`** — Holocron, trask-http, Discord bot; respects `TRASK_RESEARCH_COMPOSE_MODE` and only calls `rewriteForDiscord` when mode is `rewrite`.
- **`WebResearchClient`** — pazaak-bot `/api/trask`; always LLM-rewrote research reports on success paths.

Requirements R-13 forbids freeform digest rewrite except in explicit rewrite/degraded modes.

## Solution

1. **Shared env authority** — `loadWebResearchRuntimeConfig` now inherits `composeMode` and `groundedComposeEnabled` from `loadResearchWizardRuntimeConfig`.
2. **Shared helpers** — `isRewriteComposeEnabled` in `research-compose.ts` accepts any config carrying compose policy fields (wizard or web research).
3. **Gated rewrite** — `WebResearchClient.answerQuestion` and `answerQuestionBrief` call `rewriteForDiscord*` only when `isRewriteComposeEnabled(config)`; default grounded mode uses `sourceOnlyFallbackAnswer` or `degradedAnswerFallback`.

## Operator knobs

| Variable | Default | Effect |
|----------|---------|--------|
| `TRASK_RESEARCH_COMPOSE_MODE` | `grounded` | Set `rewrite` to re-enable LLM digest rewrite on legacy client |
| `TRASK_GROUNDED_COMPOSE` | on | When `0`, disables grounded compose on wizard path |

## Verification

```bash
pnpm build
node --test packages/config/dist/index.test.js
node --test packages/trask/dist/research-compose.test.js
```

## Related

- `docs/brainstorms/trask-rag-discord-compose-requirements.md` (R-13)
- `docs/plans/2026-05-24-026-fix-web-research-rewrite-compose-gate-plan.md`
- `packages/trask/src/research-wizard.ts` (wizard compose branches)
- `packages/trask/src/web-research.ts` (legacy client)

## History

- 2026-05-24 — R-13 parity for `WebResearchClient` after wizard path already gated rewrite compose.
