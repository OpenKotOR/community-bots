---
title: "feat: Trask Chroma backup and restore scripts"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
---

# Trask Chroma Backup / Restore Scripts

## Summary

Add operator scripts wrapping the manual `tar` backup/restore documented in the indexed stack runbook so VPS operators have a repeatable, safe path for Chroma disaster recovery.

---

## Problem Frame

Parent crawl4ai plan lists **Chroma backup automation on VPS** as remaining ops work. The runbook documents raw `tar` commands but no repo scripts.

---

## Requirements

- R1. `scripts/trask_chroma_backup.sh` archives `TRASK_INDEXER_DATA_DIR/chroma` to a timestamped tarball
- R2. `scripts/trask_chroma_restore.sh` restores from tarball with indexer-stop guard
- R3. Runbook references scripts; parent plan delta updated

---

## Scope Boundaries

- S3/cron upload automation
- Allowlist.json backup (regenerate via export)

---

## Implementation Units

- U1. Backup + restore shell scripts
- U2. Runbook + living plan delta update

**Verification:** `bash scripts/trask_chroma_backup.sh --dry-run` (when chroma dir exists or empty check)

---
