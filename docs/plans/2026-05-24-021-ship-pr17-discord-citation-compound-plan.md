---
title: "ship: merge PR #17 Discord citation compound doc"
type: ship
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-020-docs-pr15-discord-citation-compound-plan.md
pr: https://github.com/OpenKotOR/community-bots/pull/17
---

# Ship PR #17 — Discord Citation Compound Doc

## Summary

Merge PR #17 when CI green. Squash to `main` and record ship authority pointing at the compound solution doc.

---

## Requirements

- R1. All PR #17 checks pass (CodeQL).
- R2. `gh pr merge 17 --squash` succeeds.
- R3. `chore(ship)` commit on `main` records merge SHA and authority path.

---

## Scope Boundaries

- FileChunkStore phase 0 refactor (separate branch `refactor/filechunkstore-phase0`).
- Holocron full e2e (no runtime change in PR #17).

---

## Implementation Units

- U1. **Merge PR #17**

**Goal:** Land compound doc + regression tests on `main`.

**Requirements:** R1, R2

**Verification:** PR state MERGED; `main` contains solution doc path.

---

- U2. **Ship record**

**Goal:** Durable merge note for agents/operators.

**Requirements:** R3

**Dependencies:** U1

**Files:**
- Modify: `docs/plans/2026-05-24-021-ship-pr17-discord-citation-compound-plan.md` (status completed, merged SHA)

**Verification:** `chore(ship)` commit on `main`.

---

## Sources & References

- PR: https://github.com/OpenKotOR/community-bots/pull/17
- Authority: `docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md`
