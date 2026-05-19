---
title: Trask HTTP Ask Contract
owner: trask-http
status: active
lastUpdated: 2026-05-20
---

# Base path

- [REPO] Router is mounted at `/api/trask` (see `createTraskHttpRouter` in `packages/trask-http/src/router.ts`).

# `POST /api/trask/ask`

## Auth

- [REPO] Route uses `options.auth.requireAuth`; anonymous access depends on server wiring (`TRASK_WEB_ALLOW_ANONYMOUS`, `TRASK_WEB_API_KEY` patterns in `docs/trask.md`).

## Body (JSON)

| Field | Type | Notes |
|-------|------|--------|
| `query` | string | Required; trimmed; **max 200 characters** or **422** (`normalizeTraskQuery`). |
| `threadId` | UUID string (optional) | Omitted, null, or empty string → server assigns a **new random UUID** thread; invalid UUID → **422**. |
| `model` | string (optional) | Must appear in the current WebResearch model list or **422**. |
| `sourceWeights` | object (optional) | Normalized to `WebResearchSourcePreference[]` and forwarded to `answerQuestion`. |

## Responses

- [REPO] **201** — Ephemeral / non-persisting user: `answerQuestion` runs synchronously; body is `{ query: TraskQueryRecord }` with `status: "complete"` or error payload with `status: "failed"`.
- [REPO] **202** — Persisting user: initial `{ query }` has `status: "pending"`; completion is written asynchronously; Holocron polls `GET /api/trask/history` or thread endpoints (see [trask-http-session-history-contract.md](trask-http-session-history-contract.md)).
- [REPO] **422** — Invalid body (e.g. unknown `model`).
- [REPO] **502** / other — Research pipeline failure (exact status from thrown error).

## Local chunk context

- [REPO] When `TraskHttpRuntime` includes a `SearchProvider` backed by `FileChunkStore`, `webResearch.answerQuestion` merges local hits into synthesis (see [answer-pipeline.md](answer-pipeline.md)); HTTP contract does not expose chunk IDs separately from the completed `sources` list on the stored record.

# Related

- [REPO] Tests: `packages/trask-http/src/router.test.ts` (`POST /ask` cases).
- [REPO] Holocron SPA types and `fetch` helpers: [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md) (DTOs align with router payloads).
- [trask-http-session-history-contract.md](trask-http-session-history-contract.md) — session, history, thread, cancel, models, sources.
- [trask-discord-slash-contract.md](trask-discord-slash-contract.md) — Discord `/ask` parity (e.g. invalid `thread` handling vs HTTP **422**).
- [trask-embedded-holocron-web.md](trask-embedded-holocron-web.md) — bot-hosted Holocron auth (cookie / OAuth / API key).
- [trask-http-server-standalone-contract.md](trask-http-server-standalone-contract.md) — standalone server auth (API key / anonymous).
