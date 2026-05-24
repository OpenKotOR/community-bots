---
title: "fix: skip already-linked markers in embedInlineCitationLinks"
type: fix
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-055-correctness-review-pr33-citation-digit-plan.md
---

# Fix embedInlineCitationLinks Double-Wrap

## Summary

Deferred from PR #33 correctness review: `embedInlineCitationLinks` uses `CITATION_INDEX_CAPTURE_RE`, which matches `[n]` inside existing `[n](url)` markdown and can produce `[n](newUrl)(oldUrl)`. Add a bare-marker regex `(?!\()` after `]` and a regression test. Behavior unchanged for the normal compose pipeline (bare `[n]` only).

## Requirements

- R1. Export bare citation capture regex from `citation-markers.ts` (only match `[n]` not already followed by `(`).
- R2. `embedInlineCitationLinks` uses bare regex; `normalizeBodyCitationIndices` keeps full capture (remaps all markers in body).
- R3. Unit test: pre-linked `[1](url)` plus bare `[2]` → one link for 1, new link for 2, no double-wrap.
- R4. `pnpm trask:optimize-measure` composite_score **155**, all gates pass.
- R5. Ship via PR.

## Scope Boundaries

- Holocron e2e, live Discord verify.
- Changing `normalizeBodyCitationIndices` for pre-linked bodies.

## Implementation Units

### U1. Bare marker regex + embed fix

**Files:** `citation-markers.ts`, `discord-reply-format.ts`, `discord-reply-format.test.ts`

**Verification:** `node --test packages/trask/dist/discord-reply-format.test.js`

### U2. Ship

**Verification:** PR merged; ship plan on `main`.
