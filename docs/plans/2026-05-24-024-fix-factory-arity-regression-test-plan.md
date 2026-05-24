---
title: "fix: lock createResearchWizardClient factory arity regression test"
type: fix
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-022-docs-pr16-filechunkstore-phase0-compound-plan.md
---

# Lock Factory Arity Regression Test

## Summary

PR #18 code review noted the phase 0 test uses `createResearchWizardClient.length <= 2`, which would not catch a second **non-defaulted** parameter. Tighten to `=== 1` (required `config` only; `aiConfig` has a default) and add a `toString()` guard so re-adding `localSearchProvider` in the factory body fails even when arity stays 1.

**Note:** ECMAScript `Function.length` does not count parameters after the first default, so a third trailing defaulted arg would still show `length === 1`; the source guard covers that case.

---

## Problem Frame

Phase 0 removed `localSearchProvider` from the research wizard factory. The prototype checks are solid; arity lock was soft and could miss re-introducing an optional third arg.

---

## Requirements

- R1. Test asserts `createResearchWizardClient.length === 1`.
- R2. Test asserts factory source does not reference `localSearchProvider`.
- R3. Prototype checks for removed symbols remain.
- R4. `pnpm build` + `research-wizard.test.ts` pass.

---

## Scope Boundaries

- Changing factory signature or runtime behavior.
- `web-research.ts` legacy path.

---

## Implementation Units

- U1. **Tighten factory arity assertion**

**Requirements:** R1, R2, R3, R4

**Files:**
- Modify: `packages/trask/src/research-wizard.test.ts`

**Test scenarios:**
- `createResearchWizardClient.length === 1`
- No `searchLocalKnowledge` / `localSearchProvider` on prototype

**Verification:** 48+ tests pass in `research-wizard.test.ts`.

---

## Sources & References

- PR #18 review follow-up
- Plan 022 U3
