---
date: 2026-05-19
topic: trask-grounded-qa
status: draft
---

# Trask / Holocron Grounded Q&A Accuracy

## Summary

Improve Trask and Holocron so answers deliver **verifiable, tool-grade facts** (paths, tool roles, install steps) with **honest uncertainty** when evidence is thin—not answers that merely satisfy a two-link citation bar. The work reconnects existing local knowledge to the answer path, tightens the evidence-to-answer contract before user-facing prose, and surfaces evidence quality in Holocron without replacing the legacy vendor research web pipeline in one step.

---

## Problem Frame

Holocron and Discord `/ask` already run live web research on an approved-host allowlist and enforce at least two public `https://` sources in production e2e. Operators and players still get answers that **sound authoritative** while specific claims are vague, compressed, or weakly tied to what was actually retrieved.

Repo evidence points to three structural causes:

1. **Citation-shaped, not claim-shaped grounding** — The pipeline can pad or list sources that the answer body does not support, and a second generative rewrite can drift off the research report.
2. **Invested local knowledge does not reach answers** — Ingested chunks and catalog search are wired for listing and reindex flows but not merged into the main Q&A synthesis path described in older KB docs.
3. **Quality gates measure presence, not faithfulness** — The five canonical Holocron queries check topical plausibility and link count, not whether each factual bullet is backed by a retrieved passage.

Users asking toolchain questions (TSLPatcher, MDLOps, save paths, engine projects) need **absolute** details when the archives contain them—not narrative summaries that pass e2e but fail expert review.

---

## Assumptions

*(Headless brainstorm: inferred from codebase, KB, e2e, and specialist review—not user-confirmed.)*

- Primary surfaces in scope: **Holocron web** and **Discord `/ask`**; proactive brief mode should not diverge on source/model options without explicit reason.
- **legacy vendor research** remains the primary web research engine for this initiative; replacing it with a fully Trask-owned fetch loop is out of scope for this pass.
- **pgvector / semantic index** stays deferred per KB charter; passage relevance uses lexical or lightweight rerank on existing artifacts.
- Improving **claim-level faithfulness** matters more than longer or more florid answers.
- Operators will accept slightly longer latency for a two-stage evidence-then-compose path if answers are measurably better on the golden five queries.

---

## Actors

| Actor | Need |
|--------|------|
| **Holocron user** | Trustworthy answers with visible sources and clear “we don’t know” states |
| **Discord `/ask` user** | Same factual bar within Discord’s shorter interaction budget |
| **Operator / maintainer** | Ingest and reindex work that actually improves answers; eval signals beyond e2e regex |
| **KB charter** | Authority over breadth; no casual Discord chatter as ground truth |

---

## Key Flows

### F1 — Holocron research question (happy path)

1. User submits a question (optional source weights / model).
2. System gathers **web evidence** (legacy vendor research) and **local chunks** (when configured) with authority ordering.
3. System builds a **structured evidence set** (claims supported by quotes and URLs).
4. System composes a concise answer with inline citations; only cited URLs appear in the final Sources list.
5. UI shows provenance strip (cited vs consulted) and citation affordances.

### F2 — Insufficient or failed synthesis

1. Research returns stub, empty body, or fewer than two **independent supporting passages** for factual claims.
2. System **does not** pad citations to pass quotas.
3. User sees an explicit partial / ungrounded state with candidate links to review—not a confident wrong summary.

### F3 — Operator ingest → answer impact

1. Operator imports or reindexes local chunks into the shared ingest state dir.
2. Next Holocron/Discord question on matching vocabulary surfaces local context as **lower authority** than approved web sources.
3. Web citations still required for Holocron production contract.

---

## Requirements

### Evidence and synthesis

- **R-1** Every factual bullet in an answer must map to at least one **evidence item** (short quote or span + source URL) drawn from retrieved material, not from model prior knowledge alone.
- **R-2** User-facing composition must be **constrained** to the evidence set (extract-then-compose or equivalent). A single unconstrained rewrite of a long narrative report is not the default path when structured evidence is available.
- **R-3** When evidence cannot support a direct answer, the system must **abstain or partially answer** with explicit uncertainty—not invent bridging prose.
- **R-4** **Approved sources listed for the user** must be a subset of sources actually cited in the answer body (no URL padding to meet minimum counts).

### Local knowledge

- **R-5** Local chunk search must participate in the **main answer path** when ingest state is configured, labeled as lower authority than approved web hosts.
- **R-6** Local/discord-origin URLs must not satisfy Holocron’s public HTTPS citation contract.

### Source quality

- **R-7** Evidence ranking must consider **passage-level** relevance (body text from pages), not only source title/URL token overlap.
- **R-8** Authority tiers from the KotOR modding source map must influence ordering (tooling docs and project roots above generic forums when both match).
- **R-9** When two approved sources conflict on a factual claim, the answer must **state the conflict** rather than merge incompatible facts.

### Surfaces and parity

- **R-10** Holocron and Discord `/ask` must share the same grounding rules; Discord may truncate length but not weaken the evidence contract.
- **R-11** Brief/proactive research path must respect the same source preference and model options as full `/ask` where those options exist in the UI/API.

### Holocron UX (trust)

- **R-12** During research, show **which hosts** were touched (not only phase labels and counts).
- **R-13** Each completed answer exposes a short **provenance summary**: cited count, consulted-but-not-cited count, and grounding status (grounded / partial / failed).
- **R-14** Synthesis-failure and abstention states must use distinct UI treatment—not indistinguishable from a normal successful answer.

### Evaluation

- **R-15** Maintain the existing **five canonical Holocron e2e queries** as a smoke gate (≥2 HTTPS, topical regex, no synthesis stub).
- **R-16** Add an offline **faithfulness evaluation** on saved runs for those queries (e.g., claim support vs contexts) before declaring accuracy work complete.
- **R-17** Extend golden expectations with **expected fact patterns** per query (not only regex), maintained in-repo for modding toolchain questions.

---

## Acceptance Examples

**AE-1 — Citation padding forbidden**  
*Covers: R-4, R-3*  
When the compose step produces an answer with zero inline `[n]` markers but metadata lists three visited HTTPS URLs, the user-visible result is abstention or source-only guidance—not an answer with a Sources block listing URLs the body never cited.

**AE-2 — Tooling fact with quote**  
*Covers: R-1, R-2*  
For “What is TSLPatcher used for in KOTOR modding?”, the answer mentions 2DA/GFF/TLK patching (or equivalent) and each such claim appears in the evidence set with a supporting quote from an approved host.

**AE-3 — Conflict visibility**  
*Covers: R-9*  
When retrieved passages disagree on a path or version, the answer includes a short caveat naming both readings rather than picking one silently.

**AE-4 — Local chunk contributes, web still cites**  
*Covers: R-5, R-6*  
With ingest state populated for a matching chunk, the evidence bundle includes a local segment marked lower authority; the Holocron answer still shows ≥2 distinct `https://` citations and no `local://` URLs in Sources.

**AE-5 — Holocron provenance strip**  
*Covers: R-12, R-13, R-14*  
After a successful query, the UI shows cited hostnames and a grounding status line; after a synthesis-failure path, the UI shows a failed/partial banner distinct from the normal success layout.

---

## Success Criteria

1. On the five canonical queries, **human or RAGAS faithfulness** scores improve versus baseline without dropping e2e pass rate.
2. Expert review of answers finds **fewer wrong “absolute” facts** (paths, tool capabilities, file locations) on a fixed review set of ≥10 toolchain questions.
3. Reindexing local chunks produces a **measurable change** in evidence or answer content for at least one golden query tied to ingested material.
4. Holocron users can tell **grounded vs partial vs failed** without reading server logs.
5. KB/docs match runtime behavior for local merge, rewrite path, and citation rules.

---

## Scope Boundaries

**In scope**

- Evidence-then-compose pipeline changes in `@openkotor/trask`
- Local `SearchProvider` integration into `answerQuestion`
- Stricter citation ↔ claim alignment; abstention behavior
- Holocron trust UX (provenance strip, timeline hostnames, failure states)
- Faithfulness eval harness for golden queries
- KB/doc alignment with runtime

**Deferred for later**

- pgvector / embedding index for chunks
- Full replacement of legacy vendor research with Trask-owned crawl orchestration
- Cross-encoder API dependency (if avoided, use improved lexical passage rank first)
- Multi-language or non-English source expansion
- Discord history as factual ground truth

**Outside this product's identity**

- Casual Discord chat ingestion as canonical lore
- Answers without approved-web provenance on public Holocron
- Accuracy-only tuning that increases hallucination rate to pass regex tests

---

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| **Evidence envelope before user prose** | Stops grounding loss between legacy vendor research narrative and second-hop rewrite |
| **Reconnect local chunks first** | Low cost; fixes doc/runtime drift and uses existing ingest investment |
| **Tighten citation rules before expanding search breadth** | E2e already enforces links; false confidence is the dominant failure mode |
| **Keep legacy vendor research as research engine** | KB charter; focus on contract at the boundary |
| **Dual gates: e2e smoke + faithfulness eval** | Smoke protects deploy; faithfulness protects qualitative accuracy |

---

## Dependencies / Assumptions

- Headless legacy vendor research subprocess available (`vendor/removed vendor research tree`, `.venv-trask-research`, API keys).
- `INGEST_STATE_DIR` parity between ingest worker and answer hosts for local chunks.
- OpenAI-compatible key for compose pass when not using deterministic-only path.
- Holocron production remains on live legacy vendor research upstream (worker not on builtin reference API).

---

## Outstanding Questions

- Whether legacy vendor research headless output can emit structured evidence natively or needs a thin post-processor in the subprocess bridge.
- Acceptable latency budget for Holocron (120s client) vs two-pass compose on slow queries.
- Whether to retire the second LLM rewrite entirely when evidence envelope succeeds, or keep it as extractive-only fallback.

---

## Navigation

- Charter: `docs/knowledgebase/00-intent/trask-kb-charter.md`
- Runtime map: `docs/knowledgebase/10-architecture-runtime/trask-runtime-map.md`
- Synthesis today: `docs/knowledgebase/10-architecture-runtime/trask-synthesis-and-chunk-retrieval.md`
- E2e contract: `apps/holocron-web/e2e/holocron-research.spec.ts`
- Troubleshooting: `docs/knowledgebase/50-execution/trask-research-troubleshooting.md`
