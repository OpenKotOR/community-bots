---
title: "docs: PR template Trask citation gate checklist"
type: docs
status: active
date: 2026-05-24
origin: docs/plans/2026-05-24-074-contributing-trask-citation-gates-plan.md
---

# PR Template Trask Citation Gate Checklist

## Summary

Add a Trask citation offline gate checklist to `.github/pull_request_template.md` so PRs touching citation modules automatically prompt for `pnpm trask:optimize-measure` (and `:ci` when relevant).

## Requirements

- R1. New checklist section in PR template with `pnpm trask:optimize-measure`, optional `:ci`, link to module architecture doc.
- R2. N/A checkbox when Trask citation paths untouched.
- R3. Cross-link from `CONTRIBUTING.md` (one line).
- R4. `pnpm trask:optimize-measure` → composite_score **165**.

## Scope Boundaries

- Runtime code.
- Holocron/Discord live gates in template (offline only).

## Verification

`pnpm trask:optimize-measure`
