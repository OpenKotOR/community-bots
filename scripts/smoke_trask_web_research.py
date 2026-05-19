#!/usr/bin/env python3
"""Smoke test for scripts/trask_web_research.py (no API keys required for --dry-run)."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "trask_web_research.py"


def resolve_python() -> str:
    explicit = os.environ.get("TRASK_WEB_RESEARCH_PYTHON") or os.environ.get("TRASK_GPT_RESEARCHER_PYTHON")
    if explicit:
        return explicit
    unix = REPO_ROOT / ".venv-trask-research" / "bin" / "python"
    if unix.is_file():
        return str(unix)
    win = REPO_ROOT / ".venv-trask-research" / "Scripts" / "python.exe"
    if win.is_file():
        return str(win)
    return sys.executable


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Only verify imports")
    parser.add_argument("--query", default="What is TSLPatcher used for in KOTOR modding?")
    args = parser.parse_args()

    python = resolve_python()
    if not SCRIPT.is_file():
        print(f"missing script: {SCRIPT}", file=sys.stderr)
        return 1

    if args.dry_run:
        proc = subprocess.run(
            [python, str(SCRIPT), "--dry-run"],
            cwd=str(REPO_ROOT),
            capture_output=True,
            text=True,
            check=False,
        )
        if proc.returncode != 0:
            print(proc.stderr or proc.stdout, file=sys.stderr)
            return proc.returncode
        print(proc.stdout.strip())
        return 0

    payload = {
        "query": args.query,
        "query_domains": ["deadlystream.com", "github.com", "kotor.neocities.org"],
        "allowed_url_prefixes": [
            "https://deadlystream.com",
            "https://github.com",
            "https://kotor.neocities.org",
        ],
        "report_type": "research_report",
        "report_source": "web",
    }
    proc = subprocess.run(
        [python, str(SCRIPT)],
        cwd=str(REPO_ROOT),
        input=json.dumps(payload),
        capture_output=True,
        text=True,
        check=False,
        timeout=300,
    )
    if proc.returncode != 0:
        print(proc.stderr or proc.stdout, file=sys.stderr)
        return proc.returncode

    data = json.loads(proc.stdout)
    report = data.get("report", "")
    print(f"report_chars={len(report)}")
    print(report[:800])
    return 0 if report.strip() else 1


if __name__ == "__main__":
    raise SystemExit(main())
