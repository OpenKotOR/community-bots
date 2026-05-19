#!/usr/bin/env bash
# Bootstrap Python venv for Trask Crawl4AI + FastEmbed + Chroma indexer.
# Usage (from repo root):
#   pnpm --filter @openkotor/retrieval build
#   node scripts/export_trask_allowlist_catalog.mjs
#   bash scripts/bootstrap_trask_indexer.sh
#   source .venv-trask-indexer/bin/activate
#   crawl4ai-setup   # installs browser deps (once per machine)

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="${REPO_ROOT}/.venv-trask-indexer"
INDEXER_DIR="${REPO_ROOT}/infra/trask-indexer"

if [[ ! -f "${INDEXER_DIR}/pyproject.toml" ]]; then
  echo "Missing ${INDEXER_DIR}/pyproject.toml" >&2
  exit 1
fi

python3 -m venv "${VENV_DIR}"
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
python -m pip install --upgrade pip
python -m pip install -e "${INDEXER_DIR}[dev]"

echo ""
echo "Done. Activate and run smoke:"
echo "  source ${VENV_DIR}/bin/activate"
echo "  crawl4ai-setup   # if first time on this host"
echo "  python ${REPO_ROOT}/scripts/smoke_trask_indexed_stack.py"
