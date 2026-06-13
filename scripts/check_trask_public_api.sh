#!/usr/bin/env bash
# Verify public Trask API (Cloudflare Worker) health before publishing Holocron Pages.
set -euo pipefail

BASE="${TRASK_API_BASE:-}"
if [ -z "$BASE" ]; then
  echo "::error::TRASK_API_BASE is not set."
  exit 1
fi

FALLBACK_BASE="${TRASK_API_FALLBACK_BASE:-https://openkotor-holocron-trask-http.hf.space}"

BASE="${BASE%/}"
HEALTH_URL="${BASE}/healthz"
ACTIVE_BASE="$BASE"

echo "Checking ${HEALTH_URL}"
health_code="$(curl -fsS --max-time 15 -o /tmp/trask-health.json -w '%{http_code}' "${HEALTH_URL}" || true)"
if [ "$health_code" = "200" ]; then
  python3 - <<'PY'
import json
import sys

with open("/tmp/trask-health.json", encoding="utf-8") as f:
    data = json.load(f)
if not data.get("ok"):
    print("::error::Trask API health reports ok=false", file=sys.stderr)
    sys.exit(1)
fallback_active = data.get("fallbackUsed") or data.get("builtinFallback") or data.get("mode") == "degraded-builtin"
if data.get("upstreamReachable") is False and not fallback_active:
    print("::error::Trask API upstream is unreachable and no fallback is active", file=sys.stderr)
    sys.exit(1)
PY

  echo "Health OK:"
  cat /tmp/trask-health.json
else
  echo "::warning::Primary Trask API health returned HTTP ${health_code}; checking fallback origin ${FALLBACK_BASE}."
  ACTIVE_BASE="${FALLBACK_BASE%/}"
  echo "::warning::Using fallback Trask API origin ${ACTIVE_BASE}; will validate it with the ask smoke below."
fi

ASK_URL="${ACTIVE_BASE}/api/trask/ask"

thread_id="$(python3 - <<'PY'
import uuid
print(uuid.uuid4())
PY
)"

echo "Smoke POST ${ASK_URL} (expect 201/202, not 5xx)"
ask_code="$(curl -sS -o /tmp/trask-ask.json -w '%{http_code}' \
  -X POST "${ASK_URL}" \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"What is TSLPatcher used for in KOTOR modding?\",\"threadId\":\"${thread_id}\"}" \
  --max-time 35)"

if [ -z "$ask_code" ] || [ "$ask_code" -ge 500 ] 2>/dev/null || [ "$ask_code" = "000" ]; then
  echo "::error::Trask API ask returned HTTP ${ask_code}"
  cat /tmp/trask-ask.json 2>/dev/null || true
  exit 1
fi

echo "Ask smoke HTTP ${ask_code} (body truncated):"
head -c 400 /tmp/trask-ask.json 2>/dev/null || true
echo
