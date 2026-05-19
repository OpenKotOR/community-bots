---
title: Trask Knowledgebase Charter
owner: trask-bot
status: active
lastUpdated: 2026-05-15
---

# Purpose

- [USER] Build a Trask knowledgebase usable by both Discord and Holocron web UI.
- [REPO] Trask currently answers through `@openkotor/trask` and `@openkotor/trask-http` surfaces.
- [SYNTH] The first implementation pass prioritizes evidence labeling, export/import reliability, and source authority over breadth.

# Scope

- [REPO] Include approved public web and GitHub source roots currently used by Trask.
- [USER] Include Discord server text history and onboarding tone patterns as usable bot context.
- [SYNTH] Keep ingestion text-first in this pass; defer media OCR and attachment-heavy indexing.

# Non-Goals

- [SYNTH] Do not treat casual Discord chatter as factual ground truth.
- [SYNTH] Live research uses the owned Crawl4AI indexer path (`scripts/trask_web_research.py`); keep Holocron API contracts stable during cutovers.
- [SYNTH] Do not ingest private channels or private archived threads without explicit approval.

# Definition Of Done

- [SYNTH] Trask can cite local knowledge chunks in both Discord and Holocron answer surfaces.
- [SYNTH] Discord export data can be imported into `FileChunkStore` under an auditable source id.
- [SYNTH] Welcome behavior is configurable and safely scoped to an approved channel.
- [SYNTH] Knowledgebase docs remain layered, compact, and evidence-labeled.

# Navigation

- [REPO] Layer index and links: [docs/knowledgebase/README.md](../README.md).
- [REPO] KotOR source authority map: [kotor-modding-source-map.md](../20-domain-theory/kotor-modding-source-map.md).
- [REPO] Commands, env, and architecture table: [docs/trask.md](../../trask.md).
- [REPO] Structured env map: [trask-configuration-env-map.md](../50-execution/trask-configuration-env-map.md).
- [REPO] Research / chunk symptom index: [trask-research-troubleshooting.md](../50-execution/trask-research-troubleshooting.md).
- [REPO] Holocron SPA Trask client (`VITE_*`, proxy): [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md).
