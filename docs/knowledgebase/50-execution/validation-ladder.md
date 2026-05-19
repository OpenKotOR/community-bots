---
title: Trask Knowledgebase Validation Ladder
owner: trask-bot
status: active
lastUpdated: 2026-05-15
---

[SYNTH] Narrowest checks first; widen only when needed (matches vertical-slice discipline).

## 1. Docs

- [SYNTH] Every non-trivial claim in `docs/knowledgebase/**` carries `[USER]`, `[REPO]`, `[OFFICIAL]`, `[DISCORD_EXPORT]`, `[SYNTH]`, or `[OPEN]`.
- [SYNTH] `git diff --check` clean for whitespace errors.

## 2. TypeScript build

- [REPO] From repo root: `npx tsc -b tsconfig.workspace.json --pretty false` (or `pnpm check` when pnpm is available).

## 3. Package tests

- [REPO] `pnpm --filter @openkotor/trask test` or `node --test packages/trask/dist/*.test.js` after `tsc -b` for `@openkotor/trask`.
- [REPO] Ingest Discord import: `node --test apps/ingest-worker/dist/discord-export-import.test.js` after workspace build (uses [fixtures/discord-export-minimal](../../../fixtures/discord-export-minimal)).

## 4. Ingest importer (local)

- [SYNTH] `import-discord-export fixtures/discord-export-minimal --dry-run` (from repo root; see [fixtures/discord-export-minimal/README.md](../../../fixtures/discord-export-minimal/README.md)); confirm logged chunk counts and no throw.
- [SYNTH] `show-indexed` lists `approved-discord-knowledge` with non-zero chunks after a real import.
- [SYNTH] Catalog refresh: after **`queue-reindex`** (Discord or CLI), confirm **`ingest-worker drain-queue`** (or **`run-queue-worker`**) runs against the same **`INGEST_STATE_DIR`** and **`show-indexed`** / chunk mtimes move ([trask-reindex-queue-contract.md](../10-architecture-runtime/trask-reindex-queue-contract.md)).

## 5. Runtime smoke (optional)

- [REPO] HTTP contracts for Holocron: [trask-http-ask-contract.md](../10-architecture-runtime/trask-http-ask-contract.md), [trask-http-session-history-contract.md](../10-architecture-runtime/trask-http-session-history-contract.md); host wiring: [trask-embedded-holocron-web.md](../10-architecture-runtime/trask-embedded-holocron-web.md), [trask-http-server-standalone-contract.md](../10-architecture-runtime/trask-http-server-standalone-contract.md).
- [REPO] Env map: [trask-configuration-env-map.md](trask-configuration-env-map.md).
- [REPO] Holocron Vite dev client: [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md) (`TRASK_HTTP_PROXY_TARGET`, optional `VITE_TRASK_API_BASE`).
- [REPO] `bash scripts/bootstrap_trask_research.sh` and `pnpm smoke:trask-research` verify the research stack.
- [SYNTH] Holocron E2E against built static + `trask-http-server` as documented in `docs/trask.md` (requires auth env as configured).

## 6. Discord (manual)

- [SYNTH] `/ask` in an approved channel returns embed + sources.
- [SYNTH] With welcome env set, a test join posts only in the configured channel with safe mentions.
