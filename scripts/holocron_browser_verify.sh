#!/usr/bin/env bash
# Browser-verify expert Holocron verification queries via agent-browser (local :4010).
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if ! curl -sf http://127.0.0.1:4010/ >/dev/null; then
  echo "Holocron not reachable at http://127.0.0.1:4010" >&2
  exit 1
fi

mapfile -t QUERIES < <(node -e "
import { verificationQueriesForSurface } from './packages/trask-config/dist/verification-queries.js';
for (const q of verificationQueriesForSurface('browser')) console.log(q.question);
")

pass=0
fail=0

for question in "${QUERIES[@]}"; do
  echo ""
  echo "=== $question ==="
  thread="$(uuidgen)"
  agent-browser open "http://127.0.0.1:4010/?thread=${thread}" >/dev/null
  agent-browser wait --load networkidle >/dev/null
  sleep 2

  for _ in $(seq 1 20); do
    snap="$(agent-browser snapshot -i 2>&1)"
    if echo "$snap" | grep -q 'textbox "Question input"'; then
      ref="$(echo "$snap" | grep 'textbox "Question input"' | sed -n 's/.*\[ref=\(e[0-9]*\)\].*/\1/p' | head -1)"
      break
    fi
    sleep 2
  done

  agent-browser fill "@${ref}" "$question" >/dev/null
  submit_ref=""
  for _ in $(seq 1 15); do
    sleep 1
    snap="$(agent-browser snapshot -i 2>&1)"
    submit_ref="$(echo "$snap" | grep 'button "Submit question"' | grep -v disabled | sed -n 's/.*\[ref=\(e[0-9]*\)\].*/\1/p' | head -1)"
    [[ -n "$submit_ref" ]] && break
  done
  if [[ -z "$submit_ref" ]]; then
    echo "FAIL: Submit question stayed disabled"
    fail=$((fail + 1))
    continue
  fi
  agent-browser click "@${submit_ref}" >/dev/null

  ok=0
  for _ in $(seq 1 50); do
    sleep 4
    body="$(agent-browser get text body 2>/dev/null || true)"
    if echo "$body" | grep -qi 'Thinking'; then
      continue
    fi
    if echo "$body" | grep -qi 'could not complete live'; then
      echo "FAIL: degraded answer"
      fail=$((fail + 1))
      ok=1
      break
    fi
    https_count="$(echo "$body" | grep -oE 'https://[^ )"<>]+' | sort -u | wc -l)"
    if [[ "$https_count" -ge 2 ]] && [[ ${#body} -gt 80 ]]; then
      if node -e "
        import { verificationQueriesForSurface } from './packages/trask-config/dist/verification-queries.js';
        import { isHttpsCitationReachable } from './scripts/lib/url-verify.mjs';
        const q = process.argv[1];
        const body = process.argv[2];
        const spec = verificationQueriesForSurface('browser').find((e) => e.question === q);
        if (!spec) process.exit(1);
        if (spec.forbidRe && spec.forbidRe.test(body)) process.exit(1);
        if (!spec.expectRe.test(body)) process.exit(1);
        const urls = [...new Set((body.match(/https:\\/\\/[^\\s)\"<>]+/g) ?? []).map((u) => u.replace(/[.,;]+$/, '')))];
        for (const url of urls) {
          if (!(await isHttpsCitationReachable(url))) process.exit(1);
        }
        process.exit(0);
      " "$question" "$body"; then
        echo "PASS (${https_count} https URLs, on-topic, links reachable)"
        pass=$((pass + 1))
        ok=1
        break
      fi
    fi
  done

  if [[ "$ok" -eq 0 ]]; then
    echo "FAIL: timeout or off-topic / thin answer"
    fail=$((fail + 1))
  fi
done

agent-browser close 2>/dev/null || true
echo ""
echo "Browser verification: ${pass} passed, ${fail} failed"
[[ "$fail" -eq 0 ]]
