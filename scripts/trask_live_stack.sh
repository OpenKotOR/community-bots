#!/usr/bin/env bash
# Crawl4AI indexer (Chroma) + Cloudflare retrieve Worker + trask-http Holocron.
# Retrieval contract: clients POST /retrieve only to the Worker (8787), never direct Chroma.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

INDEXER_PORT="${TRASK_INDEXER_PORT:-8790}"
WORKER_PORT="${TRASK_RETRIEVE_WORKER_PORT:-8787}"
HTTP_PORT="${TRASK_HTTP_PORT:-4010}"

export TRASK_INDEXER_BASE_URL="http://127.0.0.1:${WORKER_PORT}"
export TRASK_WEB_ALLOW_ANONYMOUS="${TRASK_WEB_ALLOW_ANONYMOUS:-1}"
export TRASK_INDEXER_DATA_DIR="${TRASK_INDEXER_DATA_DIR:-$ROOT/data/trask-indexer}"
# Cached-resource contract (REQ-B): answer from the weekly-refreshed Chroma index only.
# Per-query live crawl mutates the index and makes retrieval non-deterministic; keep it
# OFF by default (R1: live crawl is recovery, not the default path). Set =1 to opt back in.
export TRASK_WEB_RESEARCH_LIVE_CRAWL="${TRASK_WEB_RESEARCH_LIVE_CRAWL:-0}"
export TRASK_TRUST_INDEXER_CITATION_URLS="${TRASK_TRUST_INDEXER_CITATION_URLS:-1}"
export TRASK_WEB_RESEARCH_LOCAL_CHROMA="${TRASK_WEB_RESEARCH_LOCAL_CHROMA:-0}"
export TRASK_WEB_RESEARCH_DDG_FALLBACK="${TRASK_WEB_RESEARCH_DDG_FALLBACK:-0}"
export TRASK_RESEARCH_COMPOSE_MODE="${TRASK_RESEARCH_COMPOSE_MODE:-grounded}"
export TRASK_LLM_PROFILE="${TRASK_LLM_PROFILE:-free}"
export TRASK_INDEXER_DENSE_RETRIEVE="${TRASK_INDEXER_DENSE_RETRIEVE:-0}"
export TRASK_INDEXER_RETRIEVE_TIMEOUT_MS="${TRASK_INDEXER_RETRIEVE_TIMEOUT_MS:-5000}"
export TRASK_RETRIEVE_UPSTREAM_TIMEOUT_MS="${TRASK_RETRIEVE_UPSTREAM_TIMEOUT_MS:-5000}"
# Fast cached-index answers: soft end-to-end budget clamps gather + compose so a
# query stays under ~30s and honest-degrades instead of stalling on live crawl.
export TRASK_RESEARCH_BUDGET_MS="${TRASK_RESEARCH_BUDGET_MS:-30000}"

for envfile in ".env" ".env.local"; do
  if [[ -f "$envfile" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$envfile"
    set +a
  fi
done

fuser -k "${HTTP_PORT}/tcp" 2>/dev/null || true
fuser -k "${WORKER_PORT}/tcp" 2>/dev/null || true
fuser -k "${INDEXER_PORT}/tcp" 2>/dev/null || true
pkill -f 'trask-http-server' 2>/dev/null || true
pkill -f 'wrangler dev.*trask-retrieve' 2>/dev/null || true
pkill -f 'trask-indexer serve' 2>/dev/null || true
sleep 1

if [[ ! -d "$ROOT/data/trask-indexer/chroma" ]]; then
  echo "Seeding Chroma QA fixtures…"
  bash scripts/bootstrap_trask_indexer.sh
  bash scripts/trask_index_seed_for_qa.sh
fi

INDEXER_BIN="${ROOT}/.venv-trask-indexer/bin/trask-indexer"
if [[ ! -x "$INDEXER_BIN" ]]; then
  echo "Missing $INDEXER_BIN — run: bash scripts/bootstrap_trask_indexer.sh" >&2
  exit 1
fi

echo "Starting Chroma indexer on :${INDEXER_PORT}…"
(
  TRASK_INDEXER_DATA_DIR="$ROOT/data/trask-indexer" \
    TRASK_INDEXER_DENSE_RETRIEVE="$TRASK_INDEXER_DENSE_RETRIEVE" \
    TRASK_INDEXER_RETRIEVE_TIMEOUT_MS="$TRASK_INDEXER_RETRIEVE_TIMEOUT_MS" \
    "$INDEXER_BIN" serve --host 127.0.0.1 --port "$INDEXER_PORT"
) &
INDEXER_PID=$!

INDEXER_READY=0
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${INDEXER_PORT}/health" >/dev/null; then
    INDEXER_READY=1
    break
  fi
  sleep 0.5
done
if [[ "$INDEXER_READY" != "1" ]]; then
  echo "Indexer failed to become healthy on :${INDEXER_PORT}" >&2
  exit 1
fi

echo "Starting retrieve Worker on :${WORKER_PORT} (proxies indexer)…"
(
  cd "$ROOT/infra/trask-retrieve-worker"
  TRASK_INDEXER_BASE_URL="http://127.0.0.1:${INDEXER_PORT}" \
    TRASK_RETRIEVE_UPSTREAM_TIMEOUT_MS="$TRASK_RETRIEVE_UPSTREAM_TIMEOUT_MS" \
    pnpm exec wrangler dev --port "$WORKER_PORT" --local-protocol http
) &
WORKER_PID=$!

WORKER_READY=0
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${WORKER_PORT}/health" >/dev/null; then
    WORKER_READY=1
    break
  fi
  sleep 0.5
done
if [[ "$WORKER_READY" != "1" ]]; then
  echo "Retrieve Worker failed to become healthy on :${WORKER_PORT}" >&2
  exit 1
fi

node scripts/holocron-e2e-live-build.mjs

echo "Starting trask-http-server on :${HTTP_PORT} (TRASK_INDEXER_BASE_URL=${TRASK_INDEXER_BASE_URL})…"
TRASK_INDEXER_BASE_URL="http://127.0.0.1:${WORKER_PORT}" \
  TRASK_INDEXER_DATA_DIR="$ROOT/data/trask-indexer" \
  TRASK_HTTP_PORT="$HTTP_PORT" \
  bash scripts/holocron-e2e-live-server.sh &
HTTP_PID=$!

HTTP_READY=0
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${HTTP_PORT}/" >/dev/null; then
    HTTP_READY=1
    break
  fi
  sleep 0.5
done
if [[ "$HTTP_READY" != "1" ]]; then
  echo "Trask HTTP server failed to become healthy on :${HTTP_PORT}" >&2
  exit 1
fi

echo ""
echo "Trask live stack ready:"
echo "  Indexer (Crawl4AI/Chroma): http://127.0.0.1:${INDEXER_PORT}"
echo "  Retrieve Worker:           http://127.0.0.1:${WORKER_PORT}/retrieve"
echo "  Holocron + API:            http://127.0.0.1:${HTTP_PORT}"
echo "PIDs: indexer=${INDEXER_PID} worker=${WORKER_PID} http=${HTTP_PID}"
echo "Stop: fuser -k ${INDEXER_PORT}/tcp ${WORKER_PORT}/tcp ${HTTP_PORT}/tcp"

wait
