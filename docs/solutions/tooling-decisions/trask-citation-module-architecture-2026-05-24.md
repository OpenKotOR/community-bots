---
title: "Trask citation module architecture (PR #33–#60)"
date: 2026-05-24
category: tooling-decisions
problem_type: architecture
component: trask
module: trask
tags:
  - trask
  - citations
  - discord
  - optimize-measure
applies_when: "Changing citation markers, answer split, query anchors, Discord display, or optimize-measure gates"
last_gate: "composite_score 165; pnpm trask:gate"
---

## Context

Trask brief Discord `/ask` and Holocron grounded compose share citation policy but use different display paths. PRs **#33–#35** aligned regex and bare-marker embed rules; **#38–#40** broke import cycles; **#41–#42** hardened offline and CI gates.

Authoritative display contract: [trask-citation-display-contract.md](../../knowledgebase/10-architecture-runtime/trask-citation-display-contract.md). Incident history and line-filter behavior: [trask-discord-dual-citation-line-filter-2026-05-24.md](trask-discord-dual-citation-line-filter-2026-05-24.md).

## Module map (dependency direction)

```
citation-markers.ts          ← regex + parseCitationIndex (**internal** — not exported from `@openkotor/trask` index)
query-anchor.ts              ← BRIEF_DISCORD_MIN_CITATIONS, distinctiveAnchorTokens, claimMatchesQueryAnchor (**exported** from `@openkotor/trask` index)
research-answer-split.ts     ← splitResearchAnswer, syncSourcesSectionToApproved (**exported** from `@openkotor/trask` index)
grounded-evidence.ts         ← compose, claims, sufficiency (imports split + anchor; re-exports anchor)
discord-reply-format.ts      ← line filters, embedInlineCitationLinks (imports markers, anchor, split; NOT grounded-evidence)
```

[SYNTH] **No cycle** on answer parsing (split) or display anchors (query-anchor). Compose still owns claim selection; display imports anchor helpers only.

## Verification gates

| Gate | Command | Proves |
|------|---------|--------|
| Recommended preflight | `pnpm trask:gate` | `trask:smoke-imports` + full `optimize-measure` + `:ci`; both runs **composite_score 165** |
| Local offline (full) | `pnpm trask:optimize-measure` | Faithfulness 5/5 + 13 discord stress tests + all citation unit suites + `pnpm check`; **composite_score 165** |
| CI offline (narrow) | `pnpm trask:optimize-measure:ci` (`TRASK_OPTIMIZE_CI_MODE=1`; same as `.github/workflows/ci.yml`) | Faithfulness + discord stress + **composite_score ≥ 165** without re-running full Trask unit matrix (unit step runs all packages separately) |
| Live Discord | `pnpm verify:trask-discord` | Preflight `trask:gate`, then LLM + indexer embed contract |
| Holocron UI | `pnpm holocron:e2e` | Preflight `trask:gate`, then Playwright on live stack |

Formula: `composite_score` = (`citation_stress_pass_count` × 10) + (`faithfulness_pass_count` × 5) + (`check_pass` × 10). Only **discord-reply-format.test.js** passes count toward `citation_stress_pass_count`.

## History (shipped)

| PR | Change |
|----|--------|
| #33 | `\d{1,3}` citation digits, `[10]` stress |
| #34 | `citation-markers.ts` shared module |
| #35 | `BARE_CITATION_INDEX_CAPTURE_RE` — no double-wrap in embed |
| #38 | `research-answer-split.ts` |
| #39 | `research-answer-split.test.ts` |
| #40 | `query-anchor.ts` — display decoupled from grounded-evidence |
| #41 | Split/anchor/markers tests in optimize-measure |
| #60 | `pnpm trask:smoke-imports` wired into `trask:gate` |
| #59 | Export `query-anchor` from `@openkotor/trask` index |
| #58 | Config drift + allowlist export use `@openkotor/retrieval`; root import compound doc |
| #57 | Root verify scripts import `@openkotor/config`; holocron browser verify uses package entries |
| #56 | Root scripts import `@openkotor/trask-config` package entry |
| #55 | Verify scripts import `@openkotor/trask` package entry |
| #54 | Export `research-answer-split` from `@openkotor/trask`; faithfulness eval uses package entry |
| #53 | KB + trask-research-backends trask:gate ladder sync |
| #52 | README + CONTRIBUTING + gate table trask:gate sync |
| #51 | AGENTS.md + docs/trask.md trask:gate ladder sync |
| #50 | Live verify / holocron:e2e preflight via `pnpm trask:gate` |
| #49 | `pnpm trask:gate` + citation stack closeout solutions doc |
| #48 | PR template Trask citation gate checklist |
| #47 | CONTRIBUTING + AGENTS learned facts for citation gates |
| #46 | CI workflow calls `pnpm trask:optimize-measure:ci` directly |
| #45 | `pnpm trask:optimize-measure:ci` script alias |
| #42 | `TRASK_OPTIMIZE_CI_MODE` — CI enforces composite floor |

## Related

- [trask-citation-stack-closeout-2026-05-24.md](trask-citation-stack-closeout-2026-05-24.md) — PR #33–#60 arc summary and `pnpm trask:gate`
- [trask-root-script-package-imports-2026-05-24.md](trask-root-script-package-imports-2026-05-24.md) — root `scripts/` workspace package imports
- `packages/trask/src/` — implementation
- `scripts/trask_optimize_measure.mjs` — measurement harness
- [validation-ladder.md](../../knowledgebase/50-execution/validation-ladder.md)
