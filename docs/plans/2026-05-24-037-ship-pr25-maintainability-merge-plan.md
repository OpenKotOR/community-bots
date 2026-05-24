---
title: "ship: merge PR #25 maintainability closeout"
type: ship
status: completed
date: 2026-05-24
merged: 5455582
origin: docs/plans/2026-05-24-035-ship-pr25-doc-review-plan.md
pr: https://github.com/OpenKotOR/community-bots/pull/25
---

# Ship PR #25 — Maintainability Closeout

## Summary

Squash-merged PR #25 to `main`. Records citation RegExp split (`CITATION_MARKER_IN_LINE_RE` vs `CITATION_INDEX_CAPTURE_RE`), `citationIndicesInLines` for distinct citation preservation, and doc-review plan updates.

---

## Requirements

- R1. Local `node scripts/trask_optimize_measure.mjs` — composite_score **115**, faithfulness **5/5**.
- R2. `gh pr merge 25 --squash` — merge SHA **5455582**.
- R3. `chore(ship)` on `main` records merge authority.

---

## Implementation Units

- U1. Merge PR #25 (CI queued >45m; merge succeeded when GitHub accepted squash).
- U2. Ship record on `main`.

---

## Authority path

`docs/plans/2026-05-24-034-maintainability-closeout-pr24-plan.md`
