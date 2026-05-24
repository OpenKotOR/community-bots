---
title: "Trask FileChunkStore phase 0 — indexed path cleanup"
date: 2026-05-24
last_refreshed: 2026-05-24
category: tooling-decisions
problem_type: architecture
component: trask
module: trask
tags:
  - "trask"
  - "filechunkstore"
  - "chroma"
  - "indexed-stack"
applies_when: "Dual-store confusion — whether FileChunkStore feeds Holocron/Discord answers or only queue-reindex"
---

## Context

Trask answers use **Chroma + Worker retrieve** (`TRASK_INDEXER_BASE_URL` → `scripts/trask_web_research.py`). A legacy **`FileChunkStore`** under `INGEST_STATE_DIR/chunks` still exists for ingest-worker and `/queue-reindex`, but was never wired into the indexed compose hot path. Dead code (`searchLocalKnowledge`, `localSearchProvider` on `ResearchWizardClient`) implied a dual-store merge that did not run in production.

## Solution (phase 0 — PR #16)

1. **Removed dead symbols** from `packages/trask/src/research-wizard.ts` — no `searchLocalKnowledge` / `localSearchProvider` on `ResearchWizardClient`.
2. **`createResearchWizardClient(config, aiConfig?)`** — factory accepts runtime + AI config only; answers use Python retrieve + grounded compose.
3. **Queue-only chunk provider** — `apps/trask-bot` and `apps/trask-http-server` keep `createChunkSearchProvider` for **`/queue-reindex`** / ingest-worker queue only (comment in `main.ts`).
4. **KB clarity** — `trask-synthesis-and-chunk-retrieval.md` states FileChunkStore is not on the hot Holocron compose path.

Phase 1+ (deferred): migrate ingest-worker drain to Chroma — see `docs/plans/2026-05-24-017-defer-filechunkstore-merge-plan.md`.

## Verification

```bash
pnpm build
node --test packages/trask/dist/research-wizard.test.js
pnpm trask:stack:health
pnpm verify:trask-discord   # indexed path unchanged
```

## Related

- `docs/plans/2026-05-24-020-refactor-filechunkstore-phase0-plan.md`
- `docs/plans/2026-05-24-017-defer-filechunkstore-merge-plan.md`
- `docs/knowledgebase/10-architecture-runtime/trask-synthesis-and-chunk-retrieval.md`
- `docs/solutions/tooling-decisions/trask-vps-indexed-stack-rollout-2026-05-24.md`
- https://github.com/OpenKotOR/community-bots/pull/16

## History

- 2026-05-24 — Landed in PR #16 (`1522b1f`); compound doc added in follow-up slice.
