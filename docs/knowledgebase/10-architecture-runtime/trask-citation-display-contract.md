---
title: Trask Citation Display Contract
owner: trask-bot
status: active
lastUpdated: 2026-05-24
related_solutions:
  - docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md
pr_refs: [33, 34, 35, 36, 38]
---

# Purpose and authority

[SYNTH] This document owns the **runtime contract** for citation markers and Discord brief display after grounded compose. It does **not** replace:

- [trask-discord-slash-contract.md](trask-discord-slash-contract.md) — slash commands, permissions, SLA, embed size limits
- [docs/solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md](../../solutions/tooling-decisions/trask-discord-dual-citation-line-filter-2026-05-24.md) — incident history and **`composite_score`** formula (authoritative for numeric gate floors)

# Shared citation markers

[REPO] `packages/trask/src/citation-markers.ts` is the single regex/index policy module (package-internal — **not** re-exported from `packages/trask/src/index.ts`).

| Export | Use |
|--------|-----|
| `CITATION_MARKER_RE` | Non-global presence test (`/\[\d{1,3}\]/`) |
| `CITATION_INDEX_CAPTURE_RE` | Global capture for `matchAll` / `replace` on bare markers |
| `BARE_CITATION_INDEX_CAPTURE_RE` | Same capture with `(?!\()` — skips `[n]` already in `[n](url)` |
| `parseCitationIndex(raw)` | Returns index only when finite and **> 0** (rejects `[0]`) |
| `collectCitationIndicesInText(text)` | Line-scoped distinct indices for compose-side checks |

[SYNTH] Changing digit width or bare-vs-full rules here affects **both** `grounded-evidence.ts` and `discord-reply-format.ts`.

# Upstream compose inputs

[REPO] `packages/trask/src/grounded-evidence.ts` produces the internal answer wire format: body lines with `[n]` plus a trailing `Sources` block. Brief Discord compose uses `BRIEF_DISCORD_MIN_CITATIONS = 2`, claim selection (`selectDistinctBriefClaims`), and sufficiency checks before the formatter runs.

[SYNTH] The display layer assumes compose already emitted enough distinct citation markers when the source pool supports it; display code **backfills** lines (see solutions doc) when query filtering would otherwise drop a second citation.

[REPO] Answer-shape parsing lives in `packages/trask/src/research-answer-split.ts` (`splitResearchAnswer`, `syncSourcesSectionToApproved`, `ResearchAnswerSource`). `grounded-evidence.ts` and `discord-reply-format.ts` import from there; `discord-reply-format.ts` re-exports split/sync for script compatibility. No `grounded-evidence` ↔ `discord-reply-format` cycle on answer parsing (PR #38).

# Discord `/ask` display pipeline

[REPO] `formatDiscordAskDisplay(rawAnswer, approvedSources, { query })` in `packages/trask/src/discord-reply-format.ts` runs in order:

1. **`syncSourcesSectionToApproved`** (`research-answer-split.ts`) — rewrites `Sources` lines to match `approvedSources` order (when sources provided)
2. **`splitResearchAnswer`** (`research-answer-split.ts`) — splits body vs numbered source lines
3. **`normalizeBodyCitationIndices`** — remaps body `[n]` to `1..N` in first-seen order (`CITATION_INDEX_CAPTURE_RE`)
4. **`buildCitationUrlMap`** — maps index → URL from Sources block or catalog
5. **`clampDiscordBodyLines`** — line cap (`DISCORD_ASK_MAX_BODY_LINES` from policy); may call **`filterDiscordLinesForQuery`** and **`ensureMinimumDistinctCitedLines`** to preserve ≥2 distinct citations for expert phrasing
6. **`embedInlineCitationLinks`** — bare `[n]` → `[n](url)` using **`BARE_CITATION_INDEX_CAPTURE_RE`**

[REPO] Exported helpers for stress tests: `citationIndicesInLines`, `citationIndicesInText` (line-scoped collection; prefer `parseCitationIndex` semantics from `citation-markers.ts`).

[SYNTH] Anti-catalog behavior: `filterDiscordLinesForQuery` scores lines against the user question; `ensureMinimumDistinctCitedLines` backfills from the cited pool so aggressive pruning does not collapse to one inline link.

# Holocron / HTTP vs Discord

| Aspect | Holocron / HTTP | Discord `/ask` |
|--------|-----------------|----------------|
| Compose profile | Full / wizard paths | `answerQuestionBrief` → brief grounded compose |
| Sources in UI | Visible panel / API fields | **Hidden** — stripped from embed |
| Body presentation | Multi-paragraph / bullets allowed | ≤5 non-empty lines, char cap per line |
| Citations | `[n]` + URLs in Sources | Inline `[n](https://…)` only |
| Display entry | HTTP record + Holocron UI | `buildResearchEmbed` + `formatDiscordAskDisplay` |

[SYNTH] Faithfulness fixtures and Holocron e2e validate full answers; **discord-reply-format.test.js** stress tests validate the display transform only.

# Constants and policy

[REPO] `DISCORD_ASK_MAX_BODY_LINES`, `DISCORD_ASK_MAX_LINE_CHARS`, `DISCORD_ASK_DESCRIPTION_MAX_LENGTH` — loaded from Trask policy (`loadTraskPolicy().discord`).

[REPO] `BRIEF_DISCORD_MIN_CITATIONS` — defined in `grounded-evidence.ts`, consumed by display filters and tests.

# Verification

[SYNTH] After any change to citation markers, display filtering, or brief compose selection, run gates in this order:

| Order | Gate | Proves |
|-------|------|--------|
| 1 | `pnpm trask:optimize-measure` | Faithfulness fixtures + discord stress tests + `pnpm check` — see solutions doc for **`composite_score`** (current floor **165**, 13 discord tests) |
| 2 | `pnpm verify:trask-discord` | Live LLM + indexer + embed contract (preflight runs optimize-measure) |
| 3 | `pnpm holocron:e2e` | Holocron UI + full research stack (preflight runs optimize-measure) |

[REPO] `scripts/trask_optimize_measure.mjs` counts only **`packages/trask/dist/discord-reply-format.test.js`** passes toward `citation_stress_pass_count`.

[SYNTH] Passing gate 1 does **not** replace gate 2 or 3 — offline stress does not cover retrieval variability or browser UX.

# Module map

| Module | Responsibility |
|--------|----------------|
| `citation-markers.ts` | Regex + `parseCitationIndex` |
| `grounded-evidence.ts` | Claims, compose, sufficiency, `collectCitationIndicesFromAnswer` |
| `discord-reply-format.ts` | Body/Sources split, Discord line surgery, inline embed |
| `discord-citation-url.ts` | `discord://` → jump URL when passages are Discord exports |
| `apps/trask-bot` | `/ask` → `answerForSurface('discord')` → embed |

# Related

- [answer-pipeline.md](answer-pipeline.md) — end-to-end research path
- [trask-discord-slash-contract.md](trask-discord-slash-contract.md) — command UX
- [trask-synthesis-and-chunk-retrieval.md](trask-synthesis-and-chunk-retrieval.md) — retrieval + synthesis
- [validation-ladder.md](../50-execution/validation-ladder.md) — repo-wide validation tiers
- [trask-indexed-stack-runbook.md](../50-execution/trask-indexed-stack-runbook.md) — stack bring-up + gates table
- [AGENTS.md](../../../AGENTS.md) — agent verification requirements
