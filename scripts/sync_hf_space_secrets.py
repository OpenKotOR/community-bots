#!/usr/bin/env python3
"""Sync selected GitHub Actions secrets into a Hugging Face Space repository."""

from __future__ import annotations

import os
import sys

from huggingface_hub import HfApi

SECRET_KEYS = (
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "TAVILY_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_CHAT_MODEL",
)

VARIABLE_KEYS = (
    ("TRASK_PUBLIC_WEB_ORIGIN", "https://openkotor.github.io"),
    ("TRASK_WEB_ALLOW_ANONYMOUS", "1"),
)


def main() -> int:
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <org/space-name>", file=sys.stderr)
        return 2

    repo_id = sys.argv[1].strip()
    api = HfApi()

    synced = 0
    for key in SECRET_KEYS:
        value = os.environ.get(key, "").strip()
        if not value:
            continue
        api.add_space_secret(repo_id=repo_id, key=key, value=value)
        print(f"Synced secret {key}")
        synced += 1

    for key, default in VARIABLE_KEYS:
        value = os.environ.get(key, default).strip()
        if not value:
            continue
        api.add_space_variable(repo_id=repo_id, key=key, value=value)
        print(f"Synced variable {key}")
        synced += 1

    if synced == 0:
        print("No secrets or variables synced (missing env values).", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
