---
title: "defer: FileChunkStore ingest merge into Chroma path"
type: defer
status: deferred
date: 2026-05-24
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
supersedes: none
---

# FileChunkStore → Chroma Merge (Deferred)

## Summary

Unify legacy `FileChunkStore` / ingest-worker lexical chunks with the authoritative Chroma indexed path. **Not required** for Crawl4AI ops closure (PR #9–#12); tracked separately.

---

## Problem Frame

Dual stores exist: `INGEST_STATE_DIR/chunks` (`FileChunkStore`) vs Chroma (`trask-indexer`). Discord sync and catalog crawl write to **Chroma**. Ingest-worker and `createChunkSearchProvider` still target FileChunkStore. Grounded compose uses Python retrieve only — local lexical merge is off the hot path.

---

## Scope (when picked up)

- Migrate or retire ingest-worker `drain-queue` FileChunkStore writes
- Remove or gate `searchLocalKnowledge` in `ResearchWizardClient`
- Operator migration for existing chunk manifests

---

## References

- `docs/knowledgebase/10-architecture-runtime/trask-synthesis-and-chunk-retrieval.md`
- `docs/plans/2026-05-19-005-feat-trask-research-agent-2026-standards-plan.md` (dual-store section)

---
