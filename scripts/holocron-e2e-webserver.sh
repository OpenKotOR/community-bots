#!/usr/bin/env bash
# Playwright webServer entry: CI-parity env, bootstrap indexer+Worker, then trask-http Holocron.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export TRASK_WEB_ALLOW_ANONYMOUS="${TRASK_WEB_ALLOW_ANONYMOUS:-1}"
export TRASK_HTTP_PORT="${TRASK_HTTP_PORT:-4010}"
export TRASK_INDEXER_BASE_URL="${TRASK_INDEXER_BASE_URL:-http://127.0.0.1:8787}"
export TRASK_QA_GROUNDING="${TRASK_QA_GROUNDING:-1}"
export TRASK_LLM_PROFILE="${TRASK_LLM_PROFILE:-free}"
export TRASK_WEB_RESEARCH_PYTHON="${TRASK_WEB_RESEARCH_PYTHON:-$ROOT/.venv-trask-indexer/bin/python}"
export TRASK_WEB_RESEARCH_DDG_FALLBACK="${TRASK_WEB_RESEARCH_DDG_FALLBACK:-0}"
export TRASK_RESEARCH_COMPOSE_MODE="${TRASK_RESEARCH_COMPOSE_MODE:-grounded}"

bash scripts/ensure_trask_indexed_stack_for_e2e.sh

exec bash scripts/holocron-e2e-live-server.sh
