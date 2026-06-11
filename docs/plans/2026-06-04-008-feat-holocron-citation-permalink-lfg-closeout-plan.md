---
status: completed
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-06-04-007-feat-holocron-answer-citation-render-plan.md
---

# Plan: Holocron citation + GitHub permalink LFG closeout

## Problem (pre-fix)

Holocron grounded answers and the Sources panel misled users when:

1. Answer body leaked raw markdown (`[label] (https://…)`) or numbered bibliography without a `Sources` heading.
2. GitHub shallow-repo citations inferred file paths from `raw.githubusercontent.com/...` URLs in passage text, producing blob paths like `githubusercontent.com/owner/repo` and labels like `KobaltBlu/KotOR.js#L1` instead of `README.md#L1`.

**Remaining (this plan):** ship commits `ab117de` and `5c568d6` on `feat/holocron-topnav-ci-followup` after PR #97 merged to `main`.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | Visible answer paragraphs strip spaced markdown links/images; preserve `[n]` citation badges. |
| R2 | Trailing `1.` bibliography lines that include `https://` URLs, without a `Sources` heading, peel into the Sources panel (or source-only body). |
| R3 | `inferGitHubFilePath` ignores http(s) URL segments and rejects domain-like path segments. |
| R4 | Holocron Sources labels use `webCitationDisplayLabel` via `@openkotor/trask/github-citation-url` (no full `@openkotor/trask` browser bundle). |
| R5 | Unit tests cover markdown sanitization, permalink inference, and malformed-blob labels. |
| R6 | Open PR, CI green, local stack smoke on `:4010` for reone query. |

## Implementation units

### U1 — Answer presentation (landed `ab117de`)

- **Files:** `apps/holocron-web/src/lib/answer-presentation.ts`, `apps/holocron-web/src/components/Message.tsx`, `scripts/answer_presentation.test.mjs`
- **Verification:** `node --import tsx/esm --test scripts/answer_presentation.test.mjs`

### U1b — Compose markdown strip (landed `ab117de`)

- **Files:** `packages/trask/src/grounded-evidence.ts`
- **Verification:** `node --test packages/trask/dist/grounded-evidence.test.js` (after `pnpm build`)

### U2 — GitHub permalink labels (landed `5c568d6`)

- **Files:** `packages/trask/src/github-citation-url.ts`, `packages/trask/package.json` (subpath export), `packages/trask/src/github-citation-url.test.ts`, `apps/holocron-web/package.json`, `apps/holocron-web/src/lib/answer-presentation.ts`
- **Verification:** `pnpm --filter @openkotor/trask build && node --test packages/trask/dist/github-citation-url.test.js`

### U3 — Docs alignment (landed `5c568d6`)

- **Files:** `docs/solutions/tooling-decisions/trask-citation-*.md`, `docs/knowledgebase/10-architecture-runtime/trask-citation-display-contract.md`
- **Verification:** paths in docs match repo; no contradictory "0 Playwright tests" claims.

## Test scenarios

- Passage with `raw.githubusercontent.com/.../icon.png` → blob URL ends with `/README.md`, label `README.md#Ln`.
- Answer with `3. [broken](https://raw...)` line → sanitized prose, no `](https://` in UI.
- Numbered-only body → Sources grid populated; no duplicate numbered paragraphs in answer.

## Verification ladder

```bash
pnpm build
node --import tsx/esm --test scripts/answer_presentation.test.mjs
node --test packages/trask/dist/github-citation-url.test.js
pnpm trask:gate:ci
bash scripts/trask_live_stack.sh
# Holocron :4010 — reone canonical query; Sources card shows README.md#Ln not owner/repo#Ln
```

## Scope boundaries

- Out of scope: HF Space recovery, production Worker deploy (see `docs/plans/2026-06-04-006-fix-holocron-public-api-connection-plan.md`).
- Out of scope: Full five-query browser MCP gate in this PR; R6 closes with one reone smoke on `:4010`. Five-query Playwright e2e is optional post-merge (`pnpm holocron:e2e`).

### U4 — Ship / verify (R6)

- Open PR from `feat/holocron-topnav-ci-followup`, CI green, `:4010` reone canonical smoke.

## Deferred to implementation

- None — feature code landed; U4 tracks PR/CI/smoke only.
