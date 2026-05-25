---
title: "Trask citation stack closeout (PR #33–#65)"
date: 2026-05-24
category: tooling-decisions
problem_type: quality
component: trask
module: trask
tags:
  - trask
  - discord
  - citations
  - optimize-measure
  - closeout
applies_when: "Onboarding to Trask citation work after May 2026 refactor arc"
last_gate: "pnpm trask:gate → composite_score 165 (full + ci)"
---

## Problem

Discord `/ask` brief embeds could collapse to a single inline citation after aggressive query-line filtering, even when the raw answer had two markers. Separately, `grounded-evidence.ts` and `discord-reply-format.ts` shared answer parsing and anchor helpers via import cycles, making display changes risky.

## Solution arc (shipped)

| Theme | PRs | Outcome |
|-------|-----|---------|
| Digit policy + stress | #33–#35 | `\d{1,3}` markers, `citation-markers.ts`, bare embed regex |
| Module extraction | #38–#40 | `research-answer-split.ts`, `query-anchor.ts`; no display↔compose cycle on parsing/anchors |
| Test + CI gates | #41–#46 | All citation unit suites in local measure; CI enforces discord stress + floor **165** |
| Contributor docs | #47–#48 | CONTRIBUTING, AGENTS, PR template checklist |
| Gate script + live preflight | #49–#50 | `pnpm trask:gate`; verify/holocron scripts preflight with gate |
| Runbook sync | #51–#53 | AGENTS, trask.md, README, CONTRIBUTING, KB ladder |
| Package exports | #54–#55 | `@openkotor/trask` index + verify scripts; `#55` live gates use package entry |
| Config imports | #56–#58 | `@openkotor/trask-config`, `@openkotor/config`, `@openkotor/retrieval` for root scripts |
| Import smoke in gate | #60–#62 | `trask:smoke-imports` in gate; CI `trask:smoke-imports:ci`; holocron e2e package entry (#61); single-build gate (#62) |
| Gate skip-check | #63 | Full measure in gate uses `TRASK_OPTIMIZE_SKIP_CHECK=1` after build |
| Config drift in gate | #64 | `pnpm trask:config-drift` inside `trask:gate` (matches CI) |
| Holocron e2e bootstrap | #66 | Playwright webServer auto-starts indexer+Worker; CI-parity env |

Authoritative module map: [trask-citation-module-architecture-2026-05-24.md](trask-citation-module-architecture-2026-05-24.md). Line-filter incident: [trask-discord-dual-citation-line-filter-2026-05-24.md](trask-discord-dual-citation-line-filter-2026-05-24.md).

## Verification ladder

```bash
pnpm trask:gate                    # one build, smoke, full measure (skip-check), :ci
pnpm verify:trask-discord          # trask:gate preflight, then live Discord (stack + token)
pnpm verify:trask-cli              # trask:gate preflight, then CLI golden queries
pnpm holocron:e2e                  # trask:gate preflight, then Playwright + live research (stack)
```

Offline floor: **composite_score 165** = 13 discord stress × 10 + faithfulness 5 × 5 + check 10.

## One-command preflight

`pnpm trask:gate` runs one `pnpm build`, import smoke, `trask:config-drift`, full `optimize-measure` with skip-build and skip-check, then `trask:optimize-measure:ci`. Use before opening a PR that touches citation modules or golden/policy data.

## Related

- [trask-citation-display-contract.md](../../knowledgebase/10-architecture-runtime/trask-citation-display-contract.md)
- [validation-ladder.md](../../knowledgebase/50-execution/validation-ladder.md)
- [CONTRIBUTING.md](../../../CONTRIBUTING.md)
