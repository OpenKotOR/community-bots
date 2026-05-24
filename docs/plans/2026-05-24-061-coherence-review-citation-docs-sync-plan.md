---
title: "docs: coherence sync for citation PRs #33–#35"
type: docs
status: completed
date: 2026-05-24
origin: ce-coherence-reviewer post-PR #35
---

# Coherence Review — Citation Docs Sync

## Summary

After PRs #33–#35, authoritative runtime gate is **`pnpm trask:optimize-measure` composite_score 165** (13 discord stress tests). Several plans and the solutions doc History still cite **115**, **135**, or **155** as if current. Align docs without changing code behavior.

## Requirements

- R1. Update `docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md` History for PR #33–#35; add authoritative gate + citation-module wording.
- R2. Fix stale `composite_score` in plans **055** (→ 155) and **059** (→ 165).
- R3. Update `docs/knowledgebase/10-architecture-runtime/trask-discord-slash-contract.md` `/ask` + Related for `citation-markers.ts` and bare vs full capture.
- R4. Optional one-line `AGENTS.md` pointer to solutions doc gate formula.
- R5. No code changes required; `pnpm trask:optimize-measure` still **165**.

## Scope Boundaries

- Rewriting all historical plans with old ≥115 floors.
- Holocron browser e2e.

## Implementation Units

### U1. Solutions + KB + plans

**Verification:** Grep shows no plan 055/059 wrong scores; History includes #33–#35.

### U2. Ship

**Verification:** PR merged; ship plan on `main`.
