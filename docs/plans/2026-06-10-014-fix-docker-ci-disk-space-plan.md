---
status: completed
branch: feat/holocron-topnav-ci-followup
origin: docs/plans/2026-06-10-013-feat-holocron-e2e-githubusercontent-contract-plan.md
date: 2026-06-10
---

# Plan: Docker CI disk space (trask-http-public export)

## Problem

`docker-builds` failed with `no space left on device` while exporting `trask-http-public` image layer containing `.venv-trask-research` (networkx test baselines).

## Inferred Intent

- **Direct ask:** Keep LFG / PR #98 merge-ready with green CI across Playwright and Docker lanes.
- **Adjacent impact:** HF Space image size, CI runner stability, monorepo docker context hygiene.
- **Cohesive scope:** `.dockerignore`, venv test-dir prune in Dockerfile, runner disk cleanup before heavy builds.
- **Risks if partial:** Intermittent red `docker-builds` blocks merge despite functional code.

## Changes

| Item | Action |
|------|--------|
| `.dockerignore` | Exclude local venvs, node_modules, git, test artifacts |
| `infra/trask-http-public/Dockerfile` | Prune `tests` / `__pycache__` from Python venvs after bootstrap |
| `docker-builds.yml` | Free disk + prune before trask-http-public build |
