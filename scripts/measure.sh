#!/usr/bin/env bash
# Run a measurement command with timeout and emit JSON on stdout.
set -euo pipefail

CMD="${1:?measurement command required}"
TIMEOUT="${2:-300}"
WORKDIR="${3:-.}"

cd "$WORKDIR"
OUTPUT="$(mktemp)"
STATUS=0
if timeout "$TIMEOUT" bash -lc "$CMD" >"$OUTPUT" 2>&1; then
  STATUS=0
else
  STATUS=$?
fi

if grep -q '^{' "$OUTPUT"; then
  cat "$OUTPUT"
else
  node -e "
    const fs = require('node:fs');
    const raw = fs.readFileSync(process.argv[1], 'utf8');
    console.log(JSON.stringify({ ok: ${STATUS} === 0, status: ${STATUS}, raw: raw.slice(-4000) }));
  " "$OUTPUT"
fi
rm -f "$OUTPUT"
exit 0
