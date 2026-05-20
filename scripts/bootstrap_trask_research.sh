#!/usr/bin/env bash
# Bootstrap Python venv for Trask live research (scripts/trask_web_research.py).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${TRASK_RESEARCH_VENV:-$ROOT/.venv-trask-research}"
PY="${VENV}/bin/python"

if [[ ! -x "$PY" ]]; then
  python3 -m venv "$VENV"
fi

"$PY" -m pip install --upgrade pip wheel
"$PY" -m pip install "ddgs>=9.0.0" httpx

INDEXER_DIR="$ROOT/infra/trask-indexer"
if [[ -f "$INDEXER_DIR/pyproject.toml" ]]; then
  "$PY" -m pip install -e "$INDEXER_DIR"
fi

echo "Trask research venv ready: $PY"
echo "Set TRASK_WEB_RESEARCH_PYTHON=$PY (optional; config auto-detects this venv)"
