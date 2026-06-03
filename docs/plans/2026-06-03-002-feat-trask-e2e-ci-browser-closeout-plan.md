---
title: "feat(trask): PR #94 CI closeout + Holocron browser 5/5"
type: feat
status: completed
date: 2026-06-03
origin: user /lfg continue + docs/plans/2026-06-03-001-feat-trask-playwright-holocron-discord-e2e-plan.md
---

# Trask e2e CI closeout + browser verification (LFG pass 2)

## Problem Frame

PR #94 wires import-smoke and Holocron Playwright into CI and restores package scripts. Pass 1 left **Build & Test** in progress and browser MCP at **2/5** expert queries. This pass closes the vertical slice: green CI, five fresh-thread browser checks on `:4010`, refreshed evidence, and PR body updates.

## Inferred Intent

- **Direct ask:** Continue Trask Discord + Holocron work with Playwright and browser proof.
- **Adjacent impact:** CI job duration (~5m e2e), PR merge readiness, agent guidance accuracy.
- **Cohesive scope:** Fix CI if Holocron e2e fails; complete browser MCP gate; no new discord.com Playwright in CI.
- **Risks if partial:** Merge with red CI; AGENTS “5/5 browser” unmet.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | PR #94 `Build & Test` green (import-smoke + holocron:e2e:playwright + final gate) |
| R2 | Browser MCP: five expert queries from `verification-queries.json`, fresh `?thread=<uuid>` each |
| R3 | If CI fails, root-cause fix (no assertion weakening) within 3 iterations |
| R4 | Append evidence note or refresh `docs/evidence/` timestamp if live verify re-run |

## Implementation Units

### U1. CI watch and autofix

**Files:** `.github/workflows/ci.yml`, e2e/spec, stack scripts as needed

**Verification:** `gh pr checks 94` all pass

### U2. Browser MCP five expert queries

**Verification:** Each query — submit enabled → assistant answer on-topic → ≥2 https citations → no stuck Thinking

### U3. Plan + PR hygiene

**Files:** this plan (`status: completed`), PR #94 body CI/browser results

## Scope Boundaries

**Out:** discord.com Playwright CI; new product features beyond e2e wiring.
