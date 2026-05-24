---
title: "fix: gate WebResearchClient rewrite compose behind composeMode"
type: fix
status: completed
date: 2026-05-24
merged: a3a214a
origin: docs/brainstorms/trask-rag-discord-compose-requirements.md
---

# Gate WebResearchClient Rewrite Compose (R-13 Parity)

## Summary

`ResearchWizardClient` only calls `rewriteForDiscord` when `TRASK_RESEARCH_COMPOSE_MODE=rewrite`. Legacy `WebResearchClient` (pazaak-bot embedded Trask) still rewrites on every successful gather path, violating R-13 and duplicating divergent compose policy. Extend runtime config with compose flags and gate rewrite branches to match `research-compose.ts` helpers.

---

## Problem Frame

Dual compose clients (`research-wizard.ts` vs `web-research.ts`) create maintainability drift: operators set grounded compose globally but pazaak `/api/trask` answers can still paraphrase digests via LLM rewrite. Requirements R-13 requires rewrite only in explicit degraded/rewrite modes.

---

## Requirements

- R1. `WebResearchRuntimeConfig` exposes `composeMode` and `groundedComposeEnabled` (sourced from existing wizard env loader).
- R2. `WebResearchClient.answerQuestion` calls `rewriteForDiscord` only when `isRewriteComposeEnabled(config)`.
- R3. When grounded/default mode and synthesis fails or sources exist, use `sourceOnlyFallbackAnswer` / `fallbackDiscordRewrite` only if rewrite mode — otherwise source-only or degraded fallbacks (mirror wizard degraded paths).
- R4. `answerQuestionBrief` gates `rewriteForDiscordBrief` the same way.
- R5. `pnpm build` + existing trask tests pass.

---

## Scope Boundaries

- Porting full `tryGroundedCompose` into `WebResearchClient` (future unification).
- Holocron / trask-bot paths (already gated on wizard client).
- FileChunkStore phase 1+ merge.

---

## Key Technical Decisions

- **Reuse helpers:** Import `isRewriteComposeEnabled` from `research-compose.ts`; do not duplicate env parsing in `web-research.ts`.
- **Config threading:** Populate compose fields in `loadWebResearchRuntimeConfig` from `loadResearchWizardRuntimeConfig` (single env authority).

---

## Implementation Units

- U1. **Extend WebResearchRuntimeConfig**

**Requirements:** R1

**Files:**
- Modify: `packages/config/src/index.ts`
- Test: `packages/config/src/index.test.ts`

**Test scenarios:**
- Happy path: default web research config inherits `composeMode: grounded`, `groundedComposeEnabled: true`
- Edge case: `TRASK_RESEARCH_COMPOSE_MODE=rewrite` propagates to web research config

**Verification:** config unit tests pass.

---

- U2. **Gate rewrite branches in WebResearchClient**

**Requirements:** R2, R3, R4

**Dependencies:** U1

**Files:**
- Modify: `packages/trask/src/web-research.ts`

**Approach:**
- Store compose policy on `WebResearchClient` from config.
- Replace unconditional `rewriteForDiscord` calls with rewrite-mode guard; grounded path uses source-only/degraded fallbacks already present in wizard.

**Test scenarios:**
- Integration expectation documented via `research-compose.test.ts` helper contract (no subprocess mock required).

**Verification:** `pnpm build`; grep shows rewrite calls guarded by `isRewriteComposeEnabled`.

---

- U3. **Compound solution + requirements delta**

**Requirements:** R5 (documentation)

**Dependencies:** U2

**Files:**
- Create: `docs/solutions/tooling-decisions/trask-web-research-rewrite-compose-gate-2026-05-24.md`
- Modify: `docs/brainstorms/trask-rag-discord-compose-requirements.md` (R-13 partial landing note)

**Test expectation:** none — documentation.

**Verification:** Solution doc links requirements R-13 and config env vars.

---

## Sources & References

- Origin: `docs/brainstorms/trask-rag-discord-compose-requirements.md` (R-13)
- Pattern: `packages/trask/src/research-wizard.ts` compose branches
- Helpers: `packages/trask/src/research-compose.ts`
