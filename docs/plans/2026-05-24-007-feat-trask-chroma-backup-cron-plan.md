---
title: "feat: Trask Chroma scheduled backup with retention and upload hook"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md
predecessor: docs/plans/2026-05-24-005-feat-trask-chroma-backup-scripts-plan.md
---

# Trask Chroma Scheduled Backup (Cron + Off-Site Hook)

## Summary

Extend the Chroma backup scripts with a **scheduled wrapper** for VPS cron: create tarball, prune old local copies, optionally run an operator-defined upload command (S3/rsync/rclone). Closes parent plan item “scheduled off-site Chroma backup upload (cron/S3)” at the repo-operator layer without baking cloud credentials into the codebase.

---

## Problem Frame

`scripts/trask_chroma_backup.sh` creates timestamped archives but operators must wire cron, retention, and off-site copy themselves. The indexed stack runbook documents manual `tar` and one-shot backup only.

---

## Requirements

- R1. `scripts/trask_chroma_backup_scheduled.sh` invokes backup, prunes archives beyond `TRASK_CHROMA_BACKUP_RETAIN` (default 7), exits non-zero on backup failure
- R2. When `TRASK_CHROMA_BACKUP_UPLOAD_CMD` is set, run it with the new archive path as `$1` after successful backup
- R3. `infra/trask-indexer/cron/trask-chroma-backup.cron.example` documents daily cron entry
- R4. Runbook section for scheduled backup + upload examples (aws s3 cp, rclone)
- R5. Parent crawl4ai plan delta marks scheduled backup landed; S3-specific automation remains operator-configured

---

## Scope Boundaries

- GitHub Actions scheduled backup
- AWS IAM / rclone config in repo
- Indexer stop during backup (online backup via tar is acceptable for v1; document restore needs indexer stopped)

---

## Implementation Units

### U1. Scheduled backup wrapper

**Files:** Create `scripts/trask_chroma_backup_scheduled.sh`

**Verification:** `--dry-run` or env with empty chroma dir test; retention logic with fake archives in /tmp test via shell

### U2. Cron example + runbook + plan delta

**Files:**
- Create `infra/trask-indexer/cron/trask-chroma-backup.cron.example`
- Modify `docs/knowledgebase/50-execution/trask-indexed-stack-runbook.md`
- Modify `docs/plans/2026-05-19-001-feat-trask-crawl4ai-rag-plan.md`

---

## Test Scenarios

- Scheduled script with `TRASK_CHROMA_BACKUP_RETAIN=2` deletes oldest when 3+ archives exist
- Upload hook skipped when unset; invoked when set (mock command in dry test)
- Cron example uses repo-absolute path pattern

---
