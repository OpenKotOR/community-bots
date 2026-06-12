# Mizuchi Agent-Native Hardening Plan

## Summary

Refactor the remaining implementation around one canonical runtime state model and one generated capability model. Preserve the current proof-first workspace contract, but remove drift between shell CLI, Rust CLI, slash commands, MCP discovery, and injected context.

## Key Changes

- Introduce a single capability registry that defines actions, parity mappings, discovery text, allowed agents, and backing runtime handlers.
- Promote Rust `decomp` to the authoritative orchestration layer for intake, case bootstrap, status, report, verification helpers, and adapter discovery; shell commands become thin compatibility wrappers.
- Replace `notes.md` regex status derivation with machine-owned lifecycle state, then teach `get_workspace_context`, `inject-context`, help surfaces, and reports to read only that source.
- Split agent-facing runtime operations into primitives for case/workspace CRUD, proof execution, report rendering, and source-candidate management; keep high-level workflows in prompts and operator docs.
- Add first-class delete/archive/reset operations for case workspaces and generated artifacts with proof-aware safeguards and explicit uncertainty recording.

## Manual Verification

- Verify action parity by enumerating every public shell/Rust/slash action and confirming a generated parity row exists.
- Run `help`, `list-prompts`, `get-workspace-context`, `inject-context`, `decomp status`, and `decomp report` against the same case and confirm state matches exactly across all surfaces.
- Validate blocked, pending, matched, and integrated cases manually to ensure no surface reports a divergent lifecycle state.
- Manually exercise create, read, update, delete, archive, and reset on one case workspace and confirm proof artifacts and uncertainty ledgers remain truthful.

## Assumptions

- The repo remains local-first and file-first.
- Automated tests stay out until the end-to-end functional surface is complete.
- Agent-native improvements must not weaken `objdiff 0` proof discipline or introduce fabricated recovery state.
