#!/usr/bin/env bash
# Verify Trask indexed stack health (indexer, optional retrieve Worker, optional Holocron HTTP).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

INDEXER_PORT="${TRASK_INDEXER_PORT:-8790}"
WORKER_PORT="${TRASK_RETRIEVE_WORKER_PORT:-8787}"
HTTP_PORT="${TRASK_HTTP_PORT:-4010}"
INDEXER_URL="${TRASK_INDEXER_HEALTH_URL:-http://127.0.0.1:${INDEXER_PORT}/health}"
WORKER_URL="${TRASK_RETRIEVE_WORKER_HEALTH_URL:-http://127.0.0.1:${WORKER_PORT}/health}"
HTTP_URL="${TRASK_HTTP_HEALTH_URL:-http://127.0.0.1:${HTTP_PORT}/}"

CHECK_WORKER=1
CHECK_HTTP=0
STRICT_STALE=0

usage() {
  echo "usage: $0 [--skip-worker] [--check-http] [--strict-stale]" >&2
  exit 1
}

while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --skip-worker) CHECK_WORKER=0; shift ;;
    --check-http) CHECK_HTTP=1; shift ;;
    --strict-stale) STRICT_STALE=1; shift ;;
    -h|--help) usage ;;
    *) echo "unknown flag: $1" >&2; usage ;;
  esac
done

failures=0

check_url() {
  local name="$1"
  local url="$2"
  if curl -sf "$url" >/dev/null; then
    echo "✓ $name OK ($url)"
    return 0
  fi
  echo "✗ $name unreachable ($url)" >&2
  failures=$((failures + 1))
  return 1
}

check_url "Chroma indexer" "$INDEXER_URL" || true

if [[ "$CHECK_WORKER" -eq 1 ]]; then
  check_url "Retrieve Worker" "$WORKER_URL" || true
fi

if [[ "$CHECK_HTTP" -eq 1 ]]; then
  check_url "Holocron HTTP" "$HTTP_URL" || true
fi

if [[ "$failures" -eq 0 ]]; then
  INDEXER_JSON="$(curl -sf "$INDEXER_URL" 2>/dev/null || true)"
  if [[ -n "$INDEXER_JSON" ]]; then
    python3 - "$INDEXER_JSON" "$STRICT_STALE" <<'PY'
import json, sys
raw, strict = sys.argv[1], sys.argv[2] == "1"
try:
    data = json.loads(raw)
except json.JSONDecodeError:
    print("⚠ indexer /health returned non-JSON", file=sys.stderr)
    sys.exit(0)
stale = data.get("discord_sync_stale")
age = data.get("discord_sync_age_hours")
last = data.get("last_discord_sync")
if stale is True:
    msg = f"⚠ discord_sync_stale=true (age_hours={age}, last={last})"
    if strict:
        print(msg, file=sys.stderr)
        sys.exit(1)
    print(msg)
elif last:
    print(f"✓ Discord sync fresh (age_hours={age}, last={last})")
PY
    stale_rc=$?
    if [[ "$stale_rc" -ne 0 ]]; then
      failures=$((failures + 1))
    fi
  fi
fi

if [[ "$failures" -gt 0 ]]; then
  echo "trask_indexed_stack_health: $failures check(s) failed" >&2
  exit 1
fi

echo "✓ Indexed stack health OK"
