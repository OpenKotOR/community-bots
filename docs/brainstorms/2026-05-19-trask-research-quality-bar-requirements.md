---
title: Trask research quality bar (holistic)
status: active
date: 2026-05-19
supersedes_notes: |
  Carries forward intent from docs/brainstorms/2026-05-19-trask-rag-fidelity-requirements.md
  and related Trask brainstorms; does not delete them until planning merges gates.
---

# Trask research quality bar (holistic)

## Problem

Holocron and Discord research often **looks** like RAG (Thinking → answer → sources) but operators cannot see **what actually ran**: which indexer/Worker URL was called, which passages returned, which URLs were verified or rejected, and why compose chose grounded vs fallback. Without that trail, bad answers (wrong topic, one citation, invented catalog links) are hard to debug and impossible to trust. Accuracy and speed matter, but **transparency is the v1 non-negotiable** so quality work can be measured and fixed.

## Actors

- **A1 — Holocron researcher** — asks KotOR modding questions in the browser UI.
- **A2 — Discord `/ask` user** — wants a short, cited briefing in-channel.
- **A3 — Operator / agent** — debugs failures using Thought process + logs after code or index changes.
- **A4 — CI / release gate** — blocks regressions on expert queries and faithfulness fixtures.

## Requirements

- **R1. Transparency (primary):** Holocron **Thought process** shows a **dense, append-only trace** for each query: absolute `TRASK_INDEXER_BASE_URL`, retrieve outcome (passage count, `index_miss`), per-passage or per-URL lines, URL-verify rejections, compose path (grounded vs fallback), and timing hints. No generic-only steps (“Researching approved archive sources…”) without follow-up detail when gather has completed.
- **R2. Transparency (logs):** The same facts appear in **structured server logs** (Python gather + Node wizard) so agents can grep without the UI — not UI-only theater.
- **R3. Accuracy floor:** Every `https://` citation must come from **retrieved passages** for that query. When the index supports it, answers must have **≥2 distinct cited sources** on-topic. Wrong-topic fluent essays are unacceptable.
- **R4. Honest failure:** When evidence is insufficient, **abstain or short degrade** with visible reason in the trace — not `partial` answers that read complete but cite one weak source.
- **R5. Speed (secondary, visible):** Discord `/ask` stays within the **90s** SLA; Holocron interactive targets **~2 minutes** for gather+compose on warm stack. Slowness is acceptable only if the trace shows **where time went** (retrieve vs compose vs LLM).
- **R6. Shared pipeline:** Holocron, Discord, and CLI share **one retrieve → passages → grounded compose** path (Worker **8787**, not raw Chroma from clients). Surface profiles differ only in presentation length.
- **R7. Verification gates:** **Expert queries** in `data/trask/eval/verification-queries.json` pass on Holocron (browser), Discord verify script, and CI where applicable; `pnpm trask:faithfulness-eval` stays green after compose/citation changes.

## Success criteria

- **AE1 — Expert TSLPatcher (Holocron):** Thought process shows Worker URL, ≥2 passage URLs including tslpatcher-relevant hosts, grounded compose; answer on-topic with ≥2 citations; trace retained after completion.
- **AE2 — Expert saves (Holocron):** Trace shows why a second citation was or was not available; if only one passage, status is **failed/abstain**, not silent partial.
- **AE3 — Agent debug without UI:** From logs alone, an operator can tell whether failure was retrieve (`index_miss`), allowlist, URL verify, or compose.
- **AE4 — Regression:** Expert five + faithfulness eval pass after any change to trask gather/compose/display.

## Scope boundaries

- Full **Vectorize** migration (deferred).
- Discord showing the **full** Holocron-length trace (Discord stays brief; logs carry detail).
- Re-crawling the entire web corpus in this pass.
- Public GitHub Pages Holocron deploy recovery (separate ops track).

### Deferred for later

- **User-facing “download trace”** export (JSON) from Holocron.
- **Live SSE** stream of trace events (polling `liveTrace` is enough for v1).
- **Automatic quality scoring** in UI (RAGAS-style); offline eval script is enough for v1.

### Outside this product's identity

- A general-purpose research agent that browses the open web without the approved corpus and Worker contract.
- Hiding retrieval behind a single “Thinking…” spinner with no inspectable steps.

## Key decisions

- **Transparency before polish** — A pretty answer with no inspectable pipeline is out of scope for “done.”
- **Holocron panel + logs** — UI for humans; logs for agents; Discord does not duplicate the full panel.
- **Accuracy is a hard floor, not #1** — Still enforced via citations and expert gates, but debugging transparency unblocks fixing accuracy and speed.
- **Supersedes fidelity brainstorm in spirit** — R1–R4 subsume citation-fidelity rules; older docs remain until `ce-plan` consolidates gates.

## Approaches considered

| Approach | Summary | Verdict |
|----------|---------|---------|
| **A — Transparency-first (chosen)** | Maximize `liveTrace` + log parity; show absolute URLs and diag keys; accept slightly longer traces | **Recommended** — matches operator pain and unblocks accuracy work |
| **B — Accuracy-first, minimal UI** | Fix retrieve/compose only; keep 3-step Thought process | Rejected — repeats today’s debug blind spots |
| **C — Speed-first** | Aggressive timeouts, strip trace detail | Rejected — conflicts with primary goal; hides failures |

## Dependencies / assumptions

- Local dev uses `bash scripts/trask_live_stack.sh` and **restarts after code changes** (`AGENTS.md`).
- Worker at `http://127.0.0.1:8787` is the client retrieve API; Chroma on **8790** is internal.
- Expert queries and golden fixtures in `data/trask/eval/` remain the product definition of “good enough” once trace proves what ran.

## Open questions

- Whether Discord should show a **one-line** trace footer (passage count + indexer host) in v1 or stay answer-only.
- Whether `partial` grounding status should be **removed entirely** from Holocron UI in favor of `grounded` | `failed` only.
