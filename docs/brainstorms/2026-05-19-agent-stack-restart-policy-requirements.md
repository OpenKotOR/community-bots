# Agent stack restart policy (Holocron / Trask)

**Created:** 2026-05-19  
**Status:** Accepted — encoded in `AGENTS.md`

## Problem

Agents treated a previously started `trask_live_stack` as still valid after editing Trask/Holocron code, reported “stack from earlier,” and validated UI behavior against stale Node/Python/static assets.

## Requirements

- R1. After any runtime-affecting change under Trask/Holocron surfaces, the agent **rebuilds** (when TypeScript changed) and **restarts** the full local stack before claiming browser or e2e success.
- R2. Agents **never** assume an earlier stack session is still running or serving new code without `curl` checks on **4010**, **8787**, and **8790**.
- R3. Default restart command is `bash scripts/trask_live_stack.sh` (indexer + Worker + Holocron **4010**).
- R4. Holocron research validation uses **http://127.0.0.1:4010**, not Vite **:5174** alone, unless `VITE_TRASK_API_BASE` is explicitly pointed at **4010**.

## Success criteria

- `AGENTS.md` states the policy in Learned User Preferences and the Holocron “Restart stack” section.
- Agents can follow one copy-paste block: `pnpm build` → `bash scripts/trask_live_stack.sh` → three `curl` health checks.

## Non-goals

- Changing CI holocron job wiring in this doc (CI already starts its own indexer; Worker parity is a separate plan item).
- Auto-reload / file-watch dev servers as the validation path.

## Key decision

**Authoritative path:** `trask_live_stack.sh` for agent validation; Playwright-only `holocron-e2e-live-server.sh` is documented as a secondary shortcut that does not replace Worker + indexer unless explicitly composed.
