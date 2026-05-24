## Summary

<!-- What changed and why (1–3 sentences). -->

## Test plan

- [ ] `pnpm check`
- [ ] `pnpm build`
- [ ] `pnpm --filter pazaak-world lint` (if TS/TSX under `apps/pazaak-world` changed)
- [ ] `pnpm --filter @openkotor/platform test` (if `packages/platform` changed)

## Trask citation gates (check if applicable)

- [ ] N/A — no changes under `packages/trask/src/` citation modules (`citation-markers`, `research-answer-split`, `query-anchor`, `discord-reply-format`, `grounded-evidence`) or `scripts/trask_optimize_measure.mjs`
- [ ] `pnpm trask:gate` — smoke-imports + **composite_score 165** on full and `:ci` runs (or `pnpm build`, `node scripts/trask_smoke_package_imports.mjs`, then both measure scripts individually)

See [CONTRIBUTING.md](CONTRIBUTING.md) and [trask-citation-module-architecture](docs/solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md). Live Discord/Holocron validation is separate ([AGENTS.md](AGENTS.md)).

## Web Audio / persistence (check if applicable)

- [ ] N/A — no audio, `localStorage` migration, or sound prefs touched
- [ ] Autoplay: verified first user gesture still enables audio where required
- [ ] `soundManager.setEnabled(false)` does not leave a running `AudioContext`
- [ ] Ambient music: `startAmbientMusic` stop handle still disposed on unmount / toggle
- [ ] Cardworld parity if `apps/pazaak-world` audio or prefs code was edited

## Risk / rollout notes

<!-- Migrations, feature flags, or operator-visible behavior. -->
