#!/usr/bin/env bash
# Playwright webServer entry — delegates to holocron-e2e-webserver.mjs (shared QA bootstrap).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
exec node --import tsx/esm scripts/holocron-e2e-webserver.mjs
