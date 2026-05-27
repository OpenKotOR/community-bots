---
title: "feat(trask): Discord footer assert in trask:gate smoke"
type: feat
status: completed
date: 2026-05-24
origin: docs/plans/2026-05-24-108-discord-verify-provenance-footer-plan.md
---

# Discord footer in trask:gate smoke

## Inferred intent

- **Direct ask:** Lock PR #81 footer contract inside `pnpm trask:gate` / `trask:smoke-imports:ci`, not only `verify_trask_discord`.
- **Adjacent impact:** Shared `scripts/lib/discord_provenance_footer.mjs`; quality-bar brainstorm open questions closed.
- **Cohesive scope:** Dedupe assert helper + smoke loop + doc note.
- **Risks if partial:** Footer can regress while `trask:gate` still passes.

## Requirements

- **R1.** Extract `assertProvenanceFooter` to `scripts/lib/discord_provenance_footer.mjs`; verify script imports it.
- **R2.** `trask_smoke_package_imports.mjs` asserts footer for all five `DISCORD_IMPORT_SMOKE_SPECS`.
- **R3.** Quality-bar brainstorm: mark Discord footer + partial UI questions resolved (#79–#81).
- **R4.** `pnpm trask:gate` / `trask:gate:ci` exit 0.

## Verification

```bash
pnpm trask:smoke-imports:ci
pnpm trask:gate:ci
```
