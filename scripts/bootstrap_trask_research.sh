#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${ROOT}/.venv-trask-research"
PY="${VENV}/bin/python"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required" >&2
  exit 1
fi

if [[ ! -d "${VENV}" ]]; then
  python3 -m venv "${VENV}"
fi

"${PY}" -m pip install --upgrade pip
"${PY}" -m pip install -r "${ROOT}/requirements-trask-research.txt"

# Install Playwright browser for Crawl4AI
if [[ -x "${VENV}/bin/playwright" ]]; then
  "${VENV}/bin/playwright" install chromium || true
fi

echo "Trask research venv ready: ${PY}"
echo "Export: TRASK_WEB_RESEARCH_PYTHON=${PY}"
