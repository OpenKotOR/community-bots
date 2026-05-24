---
title: "optimize: unify Trask citation digit policy (phase 2)"
type: optimize
status: completed
merged: 99455eb
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md
---

# Optimize Trask Citation Digit Policy (Phase 2)

## Summary

Phase 1 (`optimize/trask-citation-alignment`) raised `composite_score` to **115** (8 discord stress tests, faithfulness 5/5). Discord formatting still uses `\d{1,2}` citation markers while `grounded-evidence.ts` uses `\d{1,3}`, so answers with `[10]`+ markers can pass compose checks but fail Discord line filters and link embedding. Run a bounded `ce-optimize` serial loop to align policy, add stress coverage, and ship via PR.

## Requirements

- R1. Align `packages/trask/src/discord-reply-format.ts` citation regexes with `\d{1,3}` (match `grounded-evidence.ts` `CITATION_INDEX_RE`).
- R2. Add at least one discord-reply-format stress test for index `[10]` (distinctness / `citationIndicesInText` / embed path).
- R3. Degenerate gates unchanged: faithfulness 5/5, all scoped Trask unit suites pass, `pnpm check` pass.
- R4. Primary metric: `composite_score` from `node scripts/trask_optimize_measure.mjs` — maximize (expect **125** after new stress test if all gates hold).
- R5. Immutable: `scripts/trask_optimize_measure.mjs`, golden fixtures, measurement scripts.
- R6. Serial loop: `max_iterations: 4`, `max_hours: 1`; scratch spec under `.context/compound-engineering/ce-optimize/trask-citation-digit-policy/`.
- R7. Ship via PR to `main`.

## Scope Boundaries

- Live Holocron e2e, Discord bot posting, indexer/retrieve changes.
- Renaming `pnpm trask:optimize-measure` (deferred).
- Full consolidation of `collectCitationIndicesFromAnswer` into discord helpers (optional follow-up if disjoint).

## Implementation Units

### U1. Bootstrap ce-optimize spec and baseline (CP-0 / CP-1)

**Requirements:** R4, R5, R6

**Files:**

- Create: `.context/compound-engineering/ce-optimize/trask-citation-digit-policy/spec.yaml`
- Create: `.context/compound-engineering/ce-optimize/trask-citation-digit-policy/experiment-log.yaml` (baseline `composite_score: 115`)

**Verification:** `pnpm trask:optimize-measure` emits JSON; baseline recorded on disk.

### U2. Citation digit alignment + stress test (experiment 1)

**Requirements:** R1, R2, R3

**Files:**

- Modify: `packages/trask/src/discord-reply-format.ts` (`\d{1,2}` → `\d{1,3}` on marker, capture, normalize, embed)
- Modify: `packages/trask/src/discord-reply-format.test.ts` (new `[10]` stress case)

**Approach:** Single kept experiment — no retrieval/compose changes unless tests require.

**Test scenarios:**

- `citationIndicesInText` / `citationIndicesInLines` detect `[10]` on a cited line.
- `embedInlineCitationLinks` turns `[10]` into a markdown link when URL map includes index 10.
- `formatDiscordAskDisplay` still yields ≥2 https links for expert TSLPatcher fixture.

**Verification:** `pnpm trask:optimize-measure` → `composite_score >= 125` planned; shipped at **155** (PR #33).

### U3. Ship

**Requirements:** R7

**Verification:** PR opened; plan `status: completed` after merge.

## Risks

- `[10]` in user-facing Discord embeds is rare; alignment is correctness/consistency, not live regression observed in QA.

## Sources

- `docs/plans/2026-05-24-032-optimize-trask-citation-alignment-plan.md`
- `.context/compound-engineering/ce-optimize/trask-citation-alignment/experiment-log.yaml`
- ce-optimize skill
