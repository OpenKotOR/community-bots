#!/usr/bin/env bash
# Bootstrap a Python venv with ai-researchwizard deps for Trask headless research.
# Usage (from repo root):
#   bash scripts/bootstrap_trask_gpt_researcher.sh
# Then set TRASK_GPT_RESEARCHER_PYTHON to .venv-trask-gptr/bin/python

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV_DIR="${REPO_ROOT}/.venv-trask-gptr"
REQ_FILE="${REPO_ROOT}/vendor/ai-researchwizard/requirements.txt"

if [[ ! -f "${REQ_FILE}" ]]; then
  echo "Missing ${REQ_FILE}" >&2
  exit 1
fi

python3 -m venv "${VENV_DIR}"
# shellcheck disable=SC1091
source "${VENV_DIR}/bin/activate"
python -m pip install --upgrade pip
FALLBACK_PKG="${REPO_ROOT}/vendor/llm_fallbacks"
if [[ -f "${FALLBACK_PKG}/pyproject.toml" ]]; then
  python -m pip install "${FALLBACK_PKG}"
fi
python -m pip install -r "${REQ_FILE}"

# Install the local gpt_researcher package (vendored copy of ai-researchwizard).
# requirements.txt covers third-party deps; the package itself must be installed
# from the local source tree so `import gpt_researcher` works.
# The pyproject.toml uses Poetry which doesn't support editable install via pip,
# so we use setup.py when available; otherwise fall back to a .pth file.
SITE_PACKAGES=$(python -c "import site; print(site.getsitepackages()[0])")
if [[ -f "${REPO_ROOT}/vendor/ai-researchwizard/setup.py" ]]; then
  python "${REPO_ROOT}/vendor/ai-researchwizard/setup.py" develop 2>/dev/null || \
    echo "${REPO_ROOT}/vendor/ai-researchwizard" > "${SITE_PACKAGES}/gptr-local.pth"
else
  echo "${REPO_ROOT}/vendor/ai-researchwizard" > "${SITE_PACKAGES}/gptr-local.pth"
fi

echo ""
echo "Done. Point Trask at:"
echo "  export TRASK_GPT_RESEARCHER_PYTHON=${VENV_DIR}/bin/python"