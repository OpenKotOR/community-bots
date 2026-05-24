---
title: "refactor: simplify compose policy loading and guards"
type: refactor
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-028-fix-compose-env-parsing-hardening-plan.md
---

# Simplify Compose Policy Loading and Guards

## Summary

ce-simplify-code pass on PRs #20–#21 compose work: collapse redundant env parsing expressions, tighten `resolveResearchComposeMode`, and dedupe `isRewriteComposeEnabled(this.config)` calls in `WebResearchClient` without behavior change.

---

## Requirements

- R1. `groundedComposeEnabled` semantics unchanged (grounded mode + `TRASK_GROUNDED_COMPOSE` explicit false only).
- R2. `resolveResearchComposeMode` behavior unchanged (rewrite/grounded/unset/warn).
- R3. `WebResearchClient` rewrite gating unchanged.
- R4. `pnpm build` + config/compose tests pass.

---

## Scope Boundaries

- Unifying full compose trees between wizard and web-research.
- FileChunkStore phase 1+.

---

## Implementation Units

- U1. **Simplify config compose policy derivation**

**Requirements:** R1, R2

**Files:**
- Modify: `packages/config/src/index.ts`

**Approach:** Single-expression grounded flag; early-return compose mode resolver.

**Verification:** 53+ config tests pass.

---

- U2. **Dedupe rewrite guard in WebResearchClient**

**Requirements:** R3

**Files:**
- Modify: `packages/trask/src/web-research.ts`

**Approach:** Private getter wrapping `isRewriteComposeEnabled(this.config)`.

**Verification:** build + existing tests.

---

## Sources & References

- PRs #20, #21 compose policy work
- ce-simplify-code skill
