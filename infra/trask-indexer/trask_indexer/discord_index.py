"""Index Discord export JSON into Chroma (same embeddings as web crawl)."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from trask_indexer.chunk import chunk_markdown
from trask_indexer.chroma_store import upsert_chunks

DISCORD_SOURCE_ID = "approved-discord-knowledge"
WINDOW_MESSAGES = 25
MAX_WORDS = 380


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _sanitize(text: str) -> str:
    value = _normalize(text)
    value = re.sub(r"<@[!&]?\d+>", "@user", value)
    value = re.sub(r"<#\d+>", "#channel", value)
    value = re.sub(r"https?://(?:www\.)?discord\.gg/\S+", "[redacted-invite]", value, flags=re.I)
    value = re.sub(
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
        "[redacted-email]",
        value,
    )
    value = re.sub(
        r"(?:mfa\.)?[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}",
        "[redacted-token]",
        value,
    )
    return value


def _message_line(message: dict[str, Any]) -> str | None:
    content = _sanitize(str(message.get("content") or ""))
    if not content:
        return None
    author = message.get("author") if isinstance(message.get("author"), dict) else {}
    label = _sanitize(str(author.get("global_name") or author.get("username") or "member"))
    ts = str(message.get("timestamp") or "")
    ref = message.get("referenced_message")
    ref_id = ref.get("id") if isinstance(ref, dict) else None
    suffix = f" [reply:{ref_id}]" if ref_id else ""
    return f"[{ts}] {label}{suffix}: {content}"


def _chunk_text(channel_name: str, scope: str, lines: list[str]) -> str:
    return "\n".join(
        [
            "Discord archive context",
            f"Channel: {channel_name}",
            f"Scope: {scope}",
            "",
            *lines,
        ]
    ).strip()


def index_discord_export(
    collection,
    export_dir: Path,
    *,
    exclude_channel_ids: set[str] | None = None,
    indexed_at: str | None = None,
) -> int:
    """Upsert all container JSON files under `export_dir/containers` into Chroma."""
    exclude = {value.strip() for value in (exclude_channel_ids or set()) if value.strip()}
    extra_metadata = {"indexed_at": indexed_at} if indexed_at else None
    manifest = export_dir / "manifest.json"
    containers_dir = export_dir / "containers"
    if not manifest.is_file() or not containers_dir.is_dir():
        raise FileNotFoundError(f"Expected Discord export at {export_dir} (manifest.json + containers/)")

    total = 0
    for path in sorted(containers_dir.glob("*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        channel = payload.get("channel") if isinstance(payload.get("channel"), dict) else {}
        channel_id = str(channel.get("id") or "").strip()
        if not channel_id or channel_id in exclude:
            continue
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            continue
        channel_name = str(channel.get("name") or "unknown-channel")
        scope = str(payload.get("container_scope") or channel.get("type_name") or "channel")

        lines: list[str] = []
        window: list[str] = []
        word_count = 0
        first_id: str | None = None
        last_id: str | None = None

        def flush() -> None:
            nonlocal total, window, word_count, first_id, last_id
            if not window or not first_id or not last_id:
                return
            url = f"discord://channels/{channel_id}/{first_id}-{last_id}"
            host = f"discord:{channel_name}"
            markdown = _chunk_text(channel_name, scope, window)
            chunks = chunk_markdown(markdown, url=url)
            total += upsert_chunks(
                collection,
                url=url,
                host=host,
                source_id=DISCORD_SOURCE_ID,
                chunks=chunks,
                extra_metadata=extra_metadata,
            )
            window = []
            word_count = 0
            first_id = None
            last_id = None

        for message in messages:
            if not isinstance(message, dict):
                continue
            line = _message_line(message)
            if not line:
                continue
            message_id = str(message.get("id") or "").strip()
            if not message_id:
                continue
            if not first_id:
                first_id = message_id
            last_id = message_id
            window.append(line)
            word_count += len(line.split())
            if len(window) >= WINDOW_MESSAGES or word_count >= MAX_WORDS:
                flush()

        flush()

    return total
