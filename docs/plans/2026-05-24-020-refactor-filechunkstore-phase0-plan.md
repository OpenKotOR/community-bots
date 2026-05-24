---
title: "refactor: FileChunkStore phase 0 — indexed-path cleanup"
type: refactor
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-017-defer-filechunkstore-merge-plan.md
---

# FileChunkStore Phase 0 — Indexed Path Cleanup

## Summary

Close the first slice of the deferred FileChunkStore epic: remove dead local-chunk merge code from `ResearchWizardClient`, document that `createChunkSearchProvider` on Trask hosts is **queue-reindex only**, and add a compound solution doc for the Discord dual-citation filter fix (PR #15).

---

## Problem Frame

Indexed-stack ops are complete (Chroma + Worker authoritative), but `ResearchWizardClient` still carries an unused `searchLocalKnowledge` helper and KB docs imply it runs on the hot path. Trask bot/http still construct `createChunkSearchProvider` for `/queue-reindex` only — that wiring is easy to misread as feeding answers.

---

## Requirements

- R1. Remove unused `searchLocalKnowledge` and any now-unused `localSearchProvider` field wiring if nothing references it on the wizard hot path.
- R2. Clarify in `apps/trask-bot` and `apps/trask-http-server` that chunk search provider serves reindex queue only when indexer is configured.
- R3. Cross-link compound doc `docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md`.
- R4. Update defer plan `2026-05-24-017` with phase 0 landed note.
- R5. `pnpm build` + trask unit tests pass; `pnpm verify:trask-discord` still 5/5.

---

## Scope Boundaries

- Full FileChunkStore → Chroma merge (ingest-worker drain, migration).
- Changing pazaak-bot `WebResearchClient` local hits path.
- Holocron e2e full five-query run (optional smoke only).

---

## Implementation Units

- U1. **Remove dead local merge helper**

**Goal:** Delete `searchLocalKnowledge` if unreferenced; trim `localSearchProvider` constructor param only if unused by `createResearchWizardClient` callers.

**Requirements:** R1

**Files:**
- Modify: `packages/trask/src/research-wizard.ts`

**Test expectation:** none — deletion of dead code; existing tests cover compose path.

**Verification:** `pnpm build`; no grep hits for removed symbol except historical docs.

---

- U2. **Host comments + compound docs**

**Goal:** Operator clarity and PR #15 learning capture.

**Requirements:** R2, R3, R4

**Files:**
- Modify: `apps/trask-bot/src/main.ts`
- Modify: `apps/trask-http-server/src/main.ts`
- Create: `docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md`
- Modify: `docs/plans/2026-05-24-017-defer-filechunkstore-merge-plan.md`

**Test expectation:** none — documentation.

**Verification:** Files exist; cross-links valid.

---

- U3. **Regression gates**

**Goal:** Indexed Discord path still passes live verify.

**Requirements:** R5

**Dependencies:** U1, U2

**Verification:** `pnpm verify:trask-discord` exit 0; Holocron homepage smoke on `:4010`.

---
