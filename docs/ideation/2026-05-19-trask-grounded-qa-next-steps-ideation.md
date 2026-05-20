---
date: 2026-05-19
topic: trask-grounded-qa-next-steps
focus: prerequisites before full grounded-QA implementation
mode: repo-grounded
---

# Ideation: Trask Grounded Q&A — What to Do Before the Big Plan

## Grounding Context

**Goals** (from [docs/brainstorms/trask-grounded-qa-requirements.md](../brainstorms/trask-grounded-qa-requirements.md)):

- Verifiable, tool-grade facts with honest uncertainty when evidence is thin
- Claim-shaped grounding (not citation-shaped)
- Local ingest actually affects answers
- Holocron users can see grounded vs partial vs failed
- Faithfulness measurable on the five golden queries

**Repo blockers observed (2026-05-19):**

- `vendor/removed vendor research tree/` is **empty** in this checkout — headless legacy vendor research cannot run until submodule/bootstrap
- `.venv-trask-research` exists but is useless without vendor tree
- Plan ([docs/plans/](../plans/) cursor plan) sequences U1–U8 as if live research + baselines already exist

**Dominant failure modes** (code review, not user anecdotes):

1. `rewriteForDiscord` + `ensureMinimumWebCitations` → plausible prose, weak claim support
2. `createResearchWizardClient` does not wire `SearchProvider` into answers
3. E2e / CLI check link count and topic regex, not faithfulness

---

## Ranked Ideas

### 1. Restore the research substrate (bootstrap + one live smoke)

**Description:** Populate `vendor/removed vendor research tree`, run `scripts/bootstrap_trask_research.sh`, then one successful `scripts/verify_trask_cli_qa.mjs` or `scripts/smoke_trask_web_research.py` run on a single golden query. Nothing in the grounded-QA plan is verifiable until this works.

**Warrant:** `direct:` `vendor/removed vendor research tree/` directory listing is empty; `trask-research-subprocess.ts` throws when root/script missing.

**Rationale:** Implementation without a working legacy vendor research path is paper architecture.

**Downsides:** Submodule/auth friction; not user-visible product progress.

**Confidence:** 95%

**Complexity:** Low

**Status:** Unexplored

---

### 2. Baseline capture — save five golden runs before changing synthesis

**Description:** For each query in `holocron-research.spec.ts`, persist `(query, report, payload URLs, final answer, approvedSources)` to `data/trask-eval/baseline/`. Add a human rubric sheet (5–10 toolchain questions): mark each factual bullet supported / unsupported / wrong.

**Warrant:** `direct:` requirements R-16, R-17 and success criteria #1–2 require comparison; plan U7 assumes fixtures exist but does not require baseline first.

**Rationale:** You cannot know if grounded compose improved anything without “before.”

**Downsides:** Manual review time; API cost for five live runs.

**Confidence:** 90%

**Complexity:** Low–Medium

**Status:** Unexplored

---

### 3. Narrow spike — extract-then-compose on one query only

**Description:** Before U1–U8, prototype in isolation: split one saved legacy vendor research report into passages → extract claims with quotes (temp 0) → compose answer → compare to current `rewriteForDiscord` output on same report. No Holocron UI, no local chunks, no env flag rollout.

**Warrant:** `reasoned:` Origin outstanding question (“legacy vendor research native JSON vs TS post-processor”) is the highest-risk architectural unknown; plan defers it to U3 implementation without a spike.

**Rationale:** Validates the core bet (evidence envelope) in days, not weeks.

**Downsides:** Throwaway script if API shape changes.

**Confidence:** 85%

**Complexity:** Medium

**Status:** Unexplored

---

### 4. Citation-alignment only (U2 slice) as a fast honesty fix

**Description:** Ship only: remove URL padding, align `approvedSources` to body `[n]`, abstain when &lt;2 supported citations. Keep existing rewrite.

**Warrant:** `direct:` `ensureMinimumWebCitations` at `research-wizard.ts` ~733–768; AE-1 in requirements.

**Rationale:** Stops the worst “fake grounding” without waiting for full evidence pipeline.

**Downsides:** More abstentions; does not improve factual extraction from report.

**Confidence:** 80%

**Complexity:** Low

**Status:** Unexplored

---

### 5. Wire local chunks (U1) only after ingest proof

**Description:** Before merging local digest into answers, prove `INGEST_STATE_DIR` has chunks that should affect one golden query; otherwise U1 is dead code.

**Warrant:** `direct:` KB charter + empty chunk path in current `answerQuestion`; ingest parity called out in troubleshooting docs.

**Rationale:** Avoids another doc/runtime gap.

**Downsides:** Zero user impact if ingest empty.

**Confidence:** 75%

**Complexity:** Low–Medium

**Status:** Unexplored

---

### 6. Defer Holocron provenance UX (U6) until backend shows better answers

**Description:** Provenance strip and failure banners are trust polish; they do not increase factual accuracy. Schedule after spike + baseline show compose path wins.

**Warrant:** `direct:` requirements R-12–R14 are UX; specialist review flagged UI shows links but not quality.

**Rationale:** Plan puts U6 in phase 3 before faithfulness is proven — order feels like “ship UI for a pipeline that might not work.”

**Downsides:** Users still can’t see grounding status during transition.

**Confidence:** 70%

**Complexity:** Medium (if done early)

**Status:** Unexplored

---

### 7. Full plan U1–U8 in sequence

**Description:** Execute the cursor plan as written: local wire → citation fix → evidence module → compose → brief parity → Holocron UX → eval → docs.

**Warrant:** `direct:` existing implementation plan with eight units.

**Rationale:** Coherent end state if prerequisites already met.

**Downsides:** High risk without baseline; empty vendor blocks validation; “jumping the gun” per user.

**Confidence:** 40% (as *next* step)

**Complexity:** High

**Status:** Explored (rejected as immediate next move)

---

## Rejection Summary

| Idea | Reason Rejected |
|------|-----------------|
| Add pgvector now | Out of scope per charter; plan correctly defers |
| Replace legacy vendor research with Trask-owned crawler | Charter non-goal; huge scope |
| RAGAS in CI before baseline fixtures | Measures nothing without saved runs |
| Ideate “more search breadth” first | E2e already passes link count; false confidence is the problem |
| Discord 90s SLA work before Holocron proof | Discord is harder constraint; prove on Holocron first |

---

## Recommended course of action (synthesis)

**Do not start U3–U8 yet.** Achieve goals in this order:

1. **Substrate** — submodule + bootstrap + one live smoke (idea 1)
2. **Baseline** — five golden saves + human faithfulness rubric (idea 2)
3. **Spike** — one-query extract-then-compose vs current rewrite (idea 3)
4. **Decision gate** — if spike beats baseline on rubric, revise plan to implement grounded path behind flag; optionally ship citation-alignment (idea 4) in parallel
5. **Then** — U1 local chunks only if ingest has relevant chunks (idea 5); U6 UX after measurable backend win (idea 6)

The existing plan remains a good **target architecture** but should be reframed as **phase 2 execution**, not day-one work.
