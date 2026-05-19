$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $Root ".venv-trask-research"
$Py = Join-Path $Venv "Scripts\python.exe"

if (-not (Test-Path $Venv)) {
  python -m venv $Venv
}

& $Py -m pip install --upgrade pip
& $Py -m pip install -r (Join-Path $Root "requirements-trask-research.txt")

try {
  & (Join-Path $Venv "Scripts\playwright.exe") install chromium
} catch {
  Write-Warning "playwright chromium install skipped: $_"
}

Write-Host "Trask research venv ready: $Py"
Write-Host "Set TRASK_WEB_RESEARCH_PYTHON=$Py"
