#!/usr/bin/env python3
"""Sync optional GitHub Actions secrets into a Hugging Face Space repository.

All LLM provider keys are optional. When none are set, Trask falls back to
vendored free-model lists (llm_fallbacks) and bundled local knowledge chunks.
This script never fails solely because OpenAI or OpenRouter keys are absent.
"""

from __future__ import annotations

import os
import sys

from huggingface_hub import HfApi

# Only keys present in the environment are pushed; never required.
SECRET_KEYS = (
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "TAVILY_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_CHAT_MODEL",
    "FAST_LLM",
    "SMART_LLM",
    "STRATEGIC_LLM",
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

    synced_secrets = 0
    for key in SECRET_KEYS:
        value = os.environ.get(key, "").strip()
        if not value:
            continue
        api.add_space_secret(repo_id=repo_id, key=key, value=value)
        print(f"Synced secret {key}")
        synced_secrets += 1

    synced_variables = 0
    for key, default in VARIABLE_KEYS:
        value = os.environ.get(key, default).strip()
        if not value:
            continue
        api.add_space_variable(repo_id=repo_id, key=key, value=value)
        print(f"Synced variable {key}")
        synced_variables += 1

    if synced_secrets == 0:
        print(
            "No optional LLM secrets synced (OPENAI_API_KEY / OPENROUTER_API_KEY / … not set). "
            "Space will use llm_fallbacks free models and local knowledge when configured.",
        )
    print(f"Done: {synced_secrets} secret(s), {synced_variables} variable(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
