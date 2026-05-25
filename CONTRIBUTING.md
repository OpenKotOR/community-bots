# Contributing to community-bots

This monorepo uses **pnpm** (Node.js **≥ 24**). Authoritative runtime and product notes live in [`AGENTS.md`](AGENTS.md) at the repo root—read that before changing env-sensitive paths (Nakama, Trask, GitHub Pages base URL, etc.).

## Quick start

```bash
corepack enable
pnpm install
pnpm rebuild esbuild
pnpm build
pnpm check
```

- After a **clean** `pnpm install`, run `pnpm rebuild esbuild` once (see `pnpm-workspace.yaml` `onlyBuiltDependencies`).
- **Tests:** `pnpm test` (shorthand for `node --test packages/*/dist/*.test.js apps/*/dist/*.test.js`; packages must be built first). Use `pnpm test:watch` for an interactive watch loop during development.

## Apps and packages

- **Apps:** `apps/*` — Vite frontends (`pazaak-world`, `cardworld`, `holocron-web`, …), Discord bots, `trask-http-server`, etc.
- **Packages:** `packages/*` — shared TypeScript libraries consumed by apps.
- **Infra:** `infra/*` — Nakama bundle, Cloudflare Workers, etc.

## Trask citation gates (offline)

When you change Trask answer formatting, Discord `/ask` display, or citation modules under `packages/trask/src/` (`citation-markers.ts`, `research-answer-split.ts`, `query-anchor.ts`, `discord-reply-format.ts`, `grounded-evidence.ts`):

```bash
pnpm trask:smoke-imports         # build + workspace package import smoke (trask, trask-config, config, retrieval)
pnpm trask:smoke-imports:ci      # smoke only after build (CI uses this)
pnpm trask:gate                  # one build, smoke, config-drift, full measure (skip-check), + :ci (recommended)
# or individually:
pnpm build
pnpm trask:optimize-measure      # full local gate: faithfulness + discord stress + citation unit suites + check
pnpm trask:optimize-measure:ci   # CI-equivalent (faithfulness + discord stress only; run after build)
```

Both measure runs in `pnpm trask:gate` must reach **composite_score 165** (13 discord stress tests × 10 + faithfulness 5 × 5 + check 10). GitHub Actions runs `pnpm build`, `trask:smoke-imports:ci`, `trask:config-drift`, then `trask:optimize-measure:ci` in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

`pnpm verify:trask-cli`, `pnpm verify:trask-discord`, and `pnpm holocron:e2e` preflight with **`pnpm trask:gate`** before live or browser steps.

**Indexed stack (live gates):** `pnpm trask:smoke:stack-bootstrap` (bootstrap + health), `pnpm trask:stack:health`, and [`docs/knowledgebase/50-execution/validation-ladder.md`](docs/knowledgebase/50-execution/validation-ladder.md). CI runs `verify:trask-discord:ci` and `verify:trask-cli:ci` (**all five** canonical queries via import-smoke; no token/LLM). Editing `data/trask/eval/golden-queries.json` or `verification-queries.json` (including **`goldenQueryId`**) requires **`pnpm trask:config-drift`**. Compound reference: [`trask-qa-stack-bootstrap-2026-05-24.md`](docs/solutions/tooling-decisions/trask-qa-stack-bootstrap-2026-05-24.md).

Architecture and module map: [`docs/solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md`](docs/solutions/tooling-decisions/trask-citation-module-architecture-2026-05-24.md). Root verification scripts resolve workspace packages via root `devDependencies` (`@openkotor/trask`, `@openkotor/trask-config`, `@openkotor/config`, `@openkotor/retrieval`) — see [`trask-root-script-package-imports-2026-05-24.md`](docs/solutions/tooling-decisions/trask-root-script-package-imports-2026-05-24.md). Pull requests use the checklist in [`.github/pull_request_template.md`](.github/pull_request_template.md). Live Discord/Holocron validation: [`AGENTS.md`](AGENTS.md) (not replaced by offline gates alone).

## Lint

Only `pazaak-world` (and packages with their own eslint config) may have ESLint wired today:

```bash
pnpm --filter pazaak-world lint
```

## Pull requests

Use [`.github/pull_request_template.md`](.github/pull_request_template.md). For audio or `localStorage` migration work, complete the **Web Audio / persistence** checklist in the template body.

## Questions

Open a discussion or issue on the GitHub repo; cite `AGENTS.md` when reporting environment-specific bugs.
