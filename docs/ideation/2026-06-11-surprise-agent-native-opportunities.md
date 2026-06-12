# Ideation: Surprising agent-native opportunities for community-bots

## Top ideas (ranked)

1. Build a prompt-only Trask tool layer (high impact)
- Define a small prompt/config registry for query orchestration behaviors (e.g., strict-faithful, fast, deep-research, diagnostic) and switch behavior via prompt updates rather than branching code.
- Outcome: future tuning via docs/config instead of coordinated code edits across `packages/trask/*` and bot surfaces.

2. Add a first-class `/api/trask/agent-capabilities` discovery endpoint (high impact)
- Return machine-readable capability blocks: actions, schemas, auth level, expected latency, and current policy flags.
- Outcome: external automation can self-serve capabilities before invoking tools; better aligns with capability discovery principle.

3. Add an explicit parity map artifact (`docs/agent-parity-matrix.md`) generated from code
- Auto-generate from route handlers and interaction handlers to show user-facing actions vs agent-exposed actions.
- Outcome: prevents silent drift where UI adds actions without API/tool parity.

4. Expose “agent-safe rewrite” mode for Holocron sessions (medium)
- A toggleable flag in the UI/backend to force stricter no-speculation policy in compose and include a trace summary (`intent`, `sources`, `retry policy`).
- Outcome: improved auditability for policy review and external agent workflows.

5. Unify thread/model/session semantics across UI + bot + API (medium)
- Create one canonical schema for `session`, `thread`, `query`, and `model` objects and reuse it in `packages/trask-http`, `apps/trask-http-server`, and bots.
- Outcome: agents can read and write one coherent state contract instead of multiple shape assumptions.

6. Add lightweight shared action DSL for non-chat interactions (medium)
- Formalize a minimal JSON action vocabulary for features like query cancel/retry/regenerate/history-clear and replay in bot commands.
- Outcome: fewer bespoke routes and easier cross-surface automation.

7. Add public capability discovery in product UI (low-medium)
- In Holocron and dashboard, render a compact “What Trask can do now” panel and link to endpoint-level docs.
- Outcome: lowers discoverability gap for both users and integrations.

8. Introduce an `agent-diff` CI check (low)
- Compare user-action map against endpoint/tool map on every PR and fail when action coverage declines.
- Outcome: governance lock that enforces the parity principle over time.

## Why these ideas were selected

- High signal came from current architecture concentration around `packages/trask-http`, shared query persistence, and strict Holocron/Discord verification gates.
- Most ideas are additive and avoid altering active RAG or indexer pipelines.
- Every idea preserves existing product outcomes while improving agent-native leverage and future-proofing.
