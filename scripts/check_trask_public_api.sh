#!/usr/bin/env bash
# Verify public Trask API (Cloudflare Worker) health before publishing Holocron Pages.
set -euo pipefail

BASE="${TRASK_API_BASE:-}"
if [ -z "$BASE" ]; then
  echo "::error::TRASK_API_BASE is not set."
  exit 1
fi

BASE="${BASE%/}"
HEALTH_URL="${BASE}/healthz"
ASK_URL="${BASE}/api/trask/ask"

echo "Checking ${HEALTH_URL}"
health_code="$(curl -fsS -o /tmp/trask-health.json -w '%{http_code}' "${HEALTH_URL}" || true)"
if [ "$health_code" != "200" ]; then
  echo "::error::Trask API health returned HTTP ${health_code}"
  cat /tmp/trask-health.json 2>/dev/null || true
  exit 1
fi

python3 - <<'PY'
import json
import sys

with open("/tmp/trask-health.json", encoding="utf-8") as f:
    data = json.load(f)
if not data.get("ok"):
    print("::error::Trask API health reports ok=false", file=sys.stderr)
    sys.exit(1)
if data.get("upstreamReachable") is False:
    print("::error::Trask API upstream is unreachable", file=sys.stderr)
    sys.exit(1)
PY

echo "Health OK:"
cat /tmp/trask-health.json

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
  --max-time 90)"

if [ -z "$ask_code" ] || [ "$ask_code" -ge 500 ] 2>/dev/null || [ "$ask_code" = "000" ]; then
  echo "::error::Trask API ask returned HTTP ${ask_code}"
  cat /tmp/trask-ask.json 2>/dev/null || true
  exit 1
fi

echo "Ask smoke HTTP ${ask_code} (body truncated):"
head -c 400 /tmp/trask-ask.json 2>/dev/null || true
echo
