---
title: "Fix Holocron full-profile grounded answer duplication and markdown leak"
type: fix
status: completed
date: 2026-05-23
origin: user report — Answer region showed duplicate TSLPatcher lines and raw `- #` markdown
---

# LFG — Holocron grounded answer compose fix

## Problem frame

Holocron **full** profile answers from `composeGroundedAnswerFromClaims` duplicated the first claim (summary lead + bullet) and emitted raw passage markdown (`- # Title`) into the Answer region, which renders plain text — producing unreadable "garbage" output despite `groundingStatus: grounded`.

## Scope

**In:** Fix compose formatting in `grounded-evidence.ts`, regression test, browser verify on :4010, commit to PR #7.

**Out:** LLM rewrite path, Holocron Markdown rendering, Discord brief profile changes.

## Requirements

| R-ID | Requirement | Verification |
|------|-------------|--------------|
| R1 | No duplicate first claim in full-profile body | Unit test + API answer inspect |
| R2 | Strip `#` headings and list markers from claim lines | Unit test |
| R3 | Full profile uses one paragraph per claim with `[n]` citations | Browser MCP submit query |
| R4 | Brief profile unchanged | Existing tests pass |

## Implementation units

### U1 — Compose fix

- **Files:** `packages/trask/src/grounded-evidence.ts`
- **Change:** Unified `formatClaimLine` with `stripClaimTitle`; remove summaryLead+bullets duplication; `\n\n` between full-profile paragraphs

### U2 — Regression test

- **Files:** `packages/trask/src/grounded-evidence.test.ts`

### U3 — Browser verification

- Restart trask-http if needed; submit TSLPatcher/2DA query; confirm clean Answer text
