---
title: "fix(holocron): OpenKotOR site path links + CI cache follow-up"
type: fix
status: completed
date: 2026-06-03
origin: user /lfg + openkotor/site route convention (/projects not /#projects)
---

# Holocron TopNav + post-merge CI hardening

## Problem Frame

PR #94 merged Trask Playwright + Discord import-smoke CI. Remaining gaps: Holocron `TopNav` still linked to `openkotor.com/#projects|faq|formats` while [openkotor/site](https://github.com/openkotor/site) uses path routes `/projects`, `/faq`, `/formats`. Branch also carries review autofixes not yet on `main` (`actions: write` for cache save, hardened `ci_warm_trask_embed.sh`).

## Inferred Intent

- **Direct ask:** Continue Trask/Holocron quality; fix external nav to match production site IA.
- **Adjacent impact:** Operators clicking nav from Holocron should land on real pages, not hash anchors that may not match SPA routing.
- **Cohesive scope:** TopNav href fix; land CI follow-ups on `main`; re-run Holocron Playwright locally to confirm no regression.

## Requirements

| ID | Requirement |
|----|-------------|
| R1 | `TopNav.tsx` uses `https://openkotor.com/projects`, `/faq`, `/formats` |
| R2 | Cherry-pick or merge `actions: write` + `ci_warm_trask_embed.sh` hardening onto `main` via new PR |
| R3 | `pnpm holocron:e2e:playwright` passes with live stack (6 tests) |
| R4 | CI green on new PR |

## Out of scope

New Discord.com Playwright; re-opening merged PR #94.

## Verification

- Grep: no `openkotor.com/#` in repo
- Local Playwright 6/6 with `HOLOCRON_REUSE_SERVER=1`
- GitHub Actions CI all jobs pass
