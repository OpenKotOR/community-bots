---
title: "docs: CONTRIBUTING Trask citation gates + AGENTS learned facts"
type: docs
status: completed
date: 2026-05-24
origin: docs/solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md
---

# CONTRIBUTING Trask Citation Gates

## Summary

After PRs #33–#46, contributor-facing docs still lack a single Trask citation gate section. Add it to `CONTRIBUTING.md`, refresh `AGENTS.md` learned workspace facts, and bump solutions `last_gate` metadata.

## Requirements

- R1. `CONTRIBUTING.md` section: when to run `pnpm trask:optimize-measure` vs `:ci`, composite_score floor **165**, link to module architecture solutions doc.
- R2. `AGENTS.md` **Learned Workspace Facts** bullet for citation module stack and gate scripts.
- R3. Update `last_gate` on dual-citation and module-architecture solutions docs.
- R4. `pnpm trask:optimize-measure` → composite_score **165**.

## Scope Boundaries

- Runtime code changes.
- Holocron browser e2e in this PR.

## Verification

`pnpm trask:optimize-measure`
