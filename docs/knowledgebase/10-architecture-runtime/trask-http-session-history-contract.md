---
title: Trask HTTP Session, History, and Polling
owner: trask-http
status: active
lastUpdated: 2026-05-20
---

# Base path

- [REPO] Same router as [trask-http-ask-contract.md](trask-http-ask-contract.md): `/api/trask` from `createTraskHttpRouter` (`packages/trask-http/src/router.ts`).
- [REPO] **Auth wiring differs by host:** Discord OAuth + session cookie only on [trask-embedded-holocron-web.md](trask-embedded-holocron-web.md); API key / anonymous only on [trask-http-server-standalone-contract.md](trask-http-server-standalone-contract.md).

# `GET /api/trask/session`

- [REPO] **No** `requireAuth` wrapper; used for Holocron bootstrapping.
- [REPO] Response comes from `options.getSession(req)` when set, otherwise `{ loggedIn: false, oauthAvailable: false }` (see `TraskHttpSessionDto` in the router module).

# `POST /api/trask/auth/logout`

- [REPO] When `options.onLogout` is provided, delegates to it; otherwise responds **204** with empty body.

# `GET /api/trask/models`

- [REPO] Requires auth (`requireAuth`).
- [REPO] Returns `{ models }` built from default free-model options plus optional `webResearch.listModels()`, filtered to “free” model ids (same helper as `/ask` model validation).

# `GET /api/trask/sources`

- [REPO] Requires auth.
- [REPO] Returns `{ sources }` from `runtime.searchProvider.listSources()` (ids, names, kinds, `homeUrl`, descriptions, freshness policy).

# `GET /api/trask/history`

- [REPO] Requires auth.
- [REPO] If `user.persistQueries === false` (`shouldPersistForUser`), responds **`{ history: [] }`** without touching storage (ephemeral clients never see server-side rows).
- [REPO] Query string `thread`: optional; when present it must be a **UUID** or it is ignored (no error — invalid values become `undefined` filter).
- [REPO] Query string `limit`: parsed as number, default **25**, clamped to **1–100** (`normalizeTraskHistoryLimit`).
- [REPO] Body shape: `{ history: TraskQueryRecord[] }` each mapped through `mapTraskQueryRecord` (defensive copies of `sources` / `liveTrace`).

# `GET /api/trask/thread/:threadId`

- [REPO] Requires auth.
- [REPO] `threadId` must satisfy UUID regex; otherwise **400** `{ error: "Invalid thread id." }`.
- [REPO] History is **`listForUser(user.id, 100, threadId)`** — hard cap **100** rows for that user and thread (thread ids are not public capability URLs across users).

# `POST /api/trask/query/:queryId/cancel`

- [REPO] Requires auth.
- [REPO] `:queryId` is validated with the same UUID helper as thread ids (`isTraskThreadId`); malformed ids yield **400** `"Invalid query id."`.
- [REPO] **404** when no row exists or `userId` does not match the authenticated user.
- [REPO] If the row exists but `status !== "pending"`, returns the current `{ query }` unchanged.
- [REPO] Pending rows are overwritten to `status: "failed"` with error **`Canceled by newer request.`** and a `liveTrace` `canceled` phase entry.

# Holocron polling pattern

- [SYNTH] After **202** from `POST /ask`, poll **`GET /history?thread=<uuid>&limit=…`** (or `GET /thread/:threadId`) until the matching `queryId` reaches `complete` or `failed`, reading optional `liveTrace` for progress UI.

# Related

- [trask-http-ask-contract.md](trask-http-ask-contract.md) — `POST /ask` body and status codes.
- [trask-discord-slash-contract.md](trask-discord-slash-contract.md) — Discord-side differences (e.g. query persistence path).
- [trask-embedded-holocron-web.md](trask-embedded-holocron-web.md) — cookie session + OAuth for `/api/trask` on the bot.
- [trask-http-server-standalone-contract.md](trask-http-server-standalone-contract.md) — standalone server (no cookie path).
- [holocron-web-trask-client.md](../30-product-ux/holocron-web-trask-client.md) — browser polling and Vite env.
- [REPO] Tests: `packages/trask-http/src/router.test.ts` (history, thread isolation, cancel behavior where covered).
