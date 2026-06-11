#!/usr/bin/env bash
# Offline Discord Playwright + live Holocron (happy Playwright + browser gate) + failure Playwright.
# Start indexed stack first: bash scripts/trask_live_stack.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Discord /ask Playwright harness (:4012, offline)"
pnpm trask:e2e:discord:playwright

echo "==> Indexed stack health (:8790 / :8787 / :4010)"
if ! bash scripts/trask_indexed_stack_health.sh --check-http; then
  echo "ERROR: start the live stack before Holocron live steps:" >&2
  echo "  bash scripts/trask_live_stack.sh" >&2
  exit 1
fi

echo "==> Holocron happy-path Playwright (reuse :4010)"
HOLOCRON_REUSE_SERVER=1 pnpm holocron:e2e:playwright

echo "==> Holocron browser gate (five expert queries, evidence file)"
pnpm holocron:browser-gate

echo "==> Holocron failure-path Playwright (stops :4010 trask-http for unreachable indexer test)"
fuser -k 4010/tcp 2>/dev/null || true
pnpm holocron:e2e:playwright:failure

if [ "${TRASK_QA_PUBLIC:-0}" = "1" ]; then
  echo "==> Holocron public Pages spot-check (live worker + qa-webui)"
  pnpm holocron:public-gate
fi

echo "OK: Trask QA surfaces passed (restart stack if you still need :4010: bash scripts/trask_live_stack.sh)"
