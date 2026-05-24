---
title: "fix: harden Trask compose env parsing"
type: fix
status: completed
date: 2026-05-24
merged: b66d622
origin: docs/plans/2026-05-24-027-ship-pr20-web-research-compose-gate-plan.md
---

# Harden Trask Compose Env Parsing

## Summary

Apply security-review follow-ups from PR #20 ship: fail-fast on invalid `TRASK_GROUNDED_COMPOSE` via `readBooleanEnv`, warn operators on unrecognized `TRASK_RESEARCH_COMPOSE_MODE` values, and close plan 026 status after merge.

---

## Problem Frame

Compose policy is operator-controlled via env. Silent coercion of typos (`TRASK_RESEARCH_COMPOSE_MODE=rewite`) to grounded is safe but opaque; invalid boolean strings for `TRASK_GROUNDED_COMPOSE` were parsed ad hoc without the strict validator used elsewhere.

---

## Requirements

- R1. `TRASK_RESEARCH_COMPOSE_MODE` accepts `rewrite`, `grounded`, or unset; unrecognized non-empty values log a warning and default to `grounded`.
- R2. `TRASK_GROUNDED_COMPOSE` uses `readBooleanEnv` (throw on invalid boolean strings).
- R3. `WebResearchRuntimeConfig` continues inheriting compose fields unchanged.
- R4. Mark plan 026 `status: completed`.
- R5. `pnpm build` + config tests pass.

---

## Scope Boundaries

- Changing default compose mode or runtime compose logic.
- FileChunkStore phase 1+.

---

## Implementation Units

- U1. **Harden compose env parsing in config loader**

**Requirements:** R1, R2, R3

**Files:**
- Modify: `packages/config/src/index.ts`
- Test: `packages/config/src/index.test.ts`

**Test scenarios:**
- Unrecognized `TRASK_RESEARCH_COMPOSE_MODE` → `grounded` + warning (test via exported helper or loader side effect)
- Invalid `TRASK_GROUNDED_COMPOSE=maybe` throws
- `TRASK_GROUNDED_COMPOSE=0` disables grounded flag

**Verification:** config unit tests pass.

---

- U2. **Close plan 026**

**Requirements:** R4

**Files:**
- Modify: `docs/plans/2026-05-24-026-fix-web-research-rewrite-compose-gate-plan.md`

**Test expectation:** none — documentation.

---

## Sources & References

- Security sentinel PR #20 follow-up (invalid env handling)
- `docs/solutions/tooling-decisions/trask-web-research-rewrite-compose-gate-2026-05-24.md`
