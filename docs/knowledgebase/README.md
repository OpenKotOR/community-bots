---
title: Trask Knowledgebase Index
owner: trask-bot
status: active
lastUpdated: 2026-05-29
---

# Trask Q&A knowledgebase

[SYNTH] Layered, evidence-labeled docs for Trask Discord + Holocron: intent, runtime, domain, UX, risk, execution, and meta.

Canonical operator narrative for commands and env remains [docs/trask.md](../trask.md).

## By layer

| Layer | Doc |
|-------|-----|
| 00 Intent | [trask-kb-charter.md](00-intent/trask-kb-charter.md) |
| 10 Architecture | [trask-qa-architecture-brief.md](10-architecture-runtime/trask-qa-architecture-brief.md), [trask-runtime-map.md](10-architecture-runtime/trask-runtime-map.md), [answer-pipeline.md](10-architecture-runtime/answer-pipeline.md), [trask-research-agent-2026-standards.md](10-architecture-runtime/trask-research-agent-2026-standards.md), [trask-synthesis-and-chunk-retrieval.md](10-architecture-runtime/trask-synthesis-and-chunk-retrieval.md), [trask-reindex-queue-contract.md](10-architecture-runtime/trask-reindex-queue-contract.md), [discord-history-ingestion.md](10-architecture-runtime/discord-history-ingestion.md), [trask-http-ask-contract.md](10-architecture-runtime/trask-http-ask-contract.md), [trask-http-session-history-contract.md](10-architecture-runtime/trask-http-session-history-contract.md), [trask-http-server-standalone-contract.md](10-architecture-runtime/trask-http-server-standalone-contract.md), [trask-embedded-holocron-web.md](10-architecture-runtime/trask-embedded-holocron-web.md), [trask-discord-slash-contract.md](10-architecture-runtime/trask-discord-slash-contract.md), [trask-citation-display-contract.md](10-architecture-runtime/trask-citation-display-contract.md), [trask-proactive-mode-contract.md](10-architecture-runtime/trask-proactive-mode-contract.md), [pazaak-bot-trask-api-mount.md](10-architecture-runtime/pazaak-bot-trask-api-mount.md) |
| 20 Domain theory | [kotor-modding-source-map.md](20-domain-theory/kotor-modding-source-map.md) |
| 30 Product UX | [trask-persona-and-welcome-style.md](30-product-ux/trask-persona-and-welcome-style.md), [holocron-web-trask-client.md](30-product-ux/holocron-web-trask-client.md) |
| 40 Risk | [discord-privacy-and-source-authority.md](40-operational-risk/discord-privacy-and-source-authority.md) |
| 50 Execution | [discord-text-ingestion-runbook.md](50-execution/discord-text-ingestion-runbook.md), [discordchat-exporter-trask-bridge-runbook.md](50-execution/discordchat-exporter-trask-bridge-runbook.md), [ingest-worker-cli-runbook.md](50-execution/ingest-worker-cli-runbook.md), [trask-indexed-stack-runbook.md](50-execution/trask-indexed-stack-runbook.md), [trask-configuration-env-map.md](50-execution/trask-configuration-env-map.md), [trask-research-troubleshooting.md](50-execution/trask-research-troubleshooting.md), [validation-ladder.md](50-execution/validation-ladder.md) |
| 90 Meta | [evidence-label-contract.md](90-meta/evidence-label-contract.md), [caveat-register.md](90-meta/caveat-register.md), [prefer-defer-avoid.md](90-meta/prefer-defer-avoid.md) |

## Solutions (compound closeout)

| Doc | Use when |
|-----|----------|
| [trask-citation-stack-closeout-2026-05-24.md](../solutions/tooling-decisions/trask-citation-stack-closeout-2026-05-24.md) | Citation + quality-bar arc **PR #33–#88** and `pnpm trask:gate` ladder |
| [trask-citation-module-architecture-2026-05-24.md](../solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md) | Module map, exports, local vs CI gates |
| [trask-root-script-package-imports-2026-05-24.md](../solutions/tooling-decisions/trask-root-script-package-imports-2026-05-24.md) | Root script `@openkotor/*` imports and smoke |
| [trask-qa-stack-bootstrap-2026-05-24.md](../solutions/tooling-decisions/trask-qa-stack-bootstrap-2026-05-24.md) | Shared indexer+Worker bootstrap for Holocron e2e and live verify scripts |
| [discordchat-exporter-trask-index-bridge-2026-06-04.md](../solutions/tooling-decisions/discordchat-exporter-trask-index-bridge-2026-06-04.md) | DCE recurring scrape fork ↔ Trask Chroma index (two-repo, format bridge) |

## Quick paths

- [REPO] Export guild text: `scripts/export_discord_server.py` (see runbook).
- [REPO] **DCE recurring scrape → Trask index (two-repo):** [discordchat-exporter-trask-bridge-runbook.md](50-execution/discordchat-exporter-trask-bridge-runbook.md); sync via `scripts/trask_discord_sync.py` or `scripts/trask_discord_sync_after_scrape.sh`.
- [REPO] Import into chunks: `apps/ingest-worker` command `import-discord-export` (see runbook); minimal layout: [fixtures/discord-export-minimal/README.md](../../../fixtures/discord-export-minimal/README.md).
- [REPO] Env map (Trask bot, HTTP server, ingest): [trask-configuration-env-map.md](50-execution/trask-configuration-env-map.md).
- [REPO] Research failures, timeouts, chunk path mismatches: [trask-research-troubleshooting.md](50-execution/trask-research-troubleshooting.md).
- [REPO] Indexed Q&A architecture (REQ-A/B/C, Worker **:8787**, hybrid retrieve): [answer-pipeline.md](10-architecture-runtime/answer-pipeline.md), [trask-indexed-stack-runbook.md](50-execution/trask-indexed-stack-runbook.md).
- [REPO] Holocron validation matrix: [validation-ladder.md](50-execution/validation-ladder.md) §8, [holocron-web-trask-client.md](30-product-ux/holocron-web-trask-client.md).
- [REPO] Holocron browser client (`VITE_TRASK_*`, polling, public **qa-webui** Pages URL): [holocron-web-trask-client.md](30-product-ux/holocron-web-trask-client.md).
- [REPO] Holocron HTTP hosts: [trask-embedded-holocron-web.md](10-architecture-runtime/trask-embedded-holocron-web.md) (bot + `TRASK_WEB_PORT`) vs [trask-http-server-standalone-contract.md](10-architecture-runtime/trask-http-server-standalone-contract.md) (`pnpm dev:trask-http`).
