"""Index Discord export JSON into Chroma (same embeddings as web crawl)."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from chromadb.types import Collection

from trask_indexer.chroma_store import upsert_discord_windows
from trask_indexer.chunk import chunk_markdown

logger = logging.getLogger(__name__)

_DCE_FLAT_CHANNEL_ID_RE = re.compile(r"\[\s*(\d+)\s*\]\.json$", re.I)
_DCE_FLAT_SKIP_PREFIXES = (".dce-",)


DISCORD_SOURCE_ID = "approved-discord-knowledge"
WINDOW_MESSAGES = 25
MAX_WORDS = 380
_REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_DISCORD_EXPORT_TARGETS_CONFIG = (
    _REPO_ROOT / "data/trask/discord-export-targets.json"
)


@dataclass(frozen=True)
class DiscordExportTarget:
    name: str
    output_dir: Path
    enabled: bool = True
    disabled_reason: str = ""
    guild_ids: tuple[str, ...] = ()
    channel_ids: tuple[str, ...] = ()
    refresh_interval_seconds: int | None = None


@dataclass(frozen=True)
class DiscordTargetIndexResult:
    target: str
    enabled: bool
    skipped_reason: str = ""
    chunks_indexed: int = 0
    channels_indexed: int = 0
    degraded_reason: str = ""
    export_dir: str = ""


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _sanitize(text: str) -> str:
    value = _normalize(text)
    value = re.sub(r"<@[!&]?\d+>", "@user", value)
    value = re.sub(r"<#\d+>", "#channel", value)
    value = re.sub(
        r"https?://(?:www\.)?discord\.gg/\S+", "[redacted-invite]", value, flags=re.I
    )
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


def _content_digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _snowflake_key(value: str) -> int:
    try:
        return int(value)
    except ValueError:
        return 0


def _string_tuple(value: Any) -> tuple[str, ...]:
    if not isinstance(value, list):
        return ()
    return tuple(str(entry).strip() for entry in value if str(entry).strip())


def load_discord_export_targets(
    config_path: Path = DEFAULT_DISCORD_EXPORT_TARGETS_CONFIG,
) -> list[DiscordExportTarget]:
    try:
        payload: dict[str, Any] = json.loads(config_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        logger.warning("Skipping unreadable targets config: %s", config_path)
        return []
    except Exception:
        logger.warning(
            "Skipping unknown targets config error: %s",
            config_path,
            exc_info=True,
        )
        return []
    defaults: dict[str, Any] = (
        payload.get("defaults") if isinstance(payload.get("defaults"), dict) else {}
    )
    default_refresh = defaults.get("refresh_interval_seconds")
    targets: list[dict[str, Any]] = payload.get("targets")
    if not isinstance(targets, list):
        raise ValueError(f"Expected targets list in {config_path}")

    parsed: list[DiscordExportTarget] = []
    for raw in targets:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        output_dir = str(raw.get("output_dir") or "").strip()
        if not name or not output_dir:
            continue
        refresh_raw = raw.get("refresh_interval_seconds", default_refresh)
        refresh_interval_seconds = (
            int(refresh_raw) if isinstance(refresh_raw, int | float) else None
        )
        parsed.append(
            DiscordExportTarget(
                name=name,
                output_dir=Path(output_dir),
                enabled=raw.get("enabled") is not False,
                disabled_reason=str(raw.get("disabled_reason") or "").strip(),
                guild_ids=_string_tuple(raw.get("guild_ids")),
                channel_ids=_string_tuple(raw.get("channel_ids")),
                refresh_interval_seconds=refresh_interval_seconds,
            ),
        )
    return parsed


def _channel_id_from_dce_filename(path: Path) -> str:
    match = _DCE_FLAT_CHANNEL_ID_RE.search(path.name)
    return match.group(1) if match else ""


def _is_dce_flat_json_file(path: Path) -> bool:
    if not path.is_file() or path.suffix.lower() != ".json":
        return False
    if ".bak." in path.name or path.name.endswith(".json.bak"):
        return False
    if path.name.startswith(_DCE_FLAT_SKIP_PREFIXES):
        return False
    return bool(_channel_id_from_dce_filename(path))


def _has_dce_flat_layout(output_dir: Path) -> bool:
    if not output_dir.is_dir():
        return False
    return any(_is_dce_flat_json_file(child) for child in output_dir.iterdir())


def _dce_flat_container_paths(
    output_dir: Path,
    *,
    include_channel_ids: set[str] | None = None,
) -> list[Path]:
    include = _id_set(include_channel_ids)
    paths: list[Path] = []
    for child in sorted(output_dir.iterdir()):
        if not _is_dce_flat_json_file(child):
            continue
        channel_id = _channel_id_from_dce_filename(child)
        if include and channel_id not in include:
            continue
        paths.append(child)
    return paths


def _resolve_export_dirs(target: DiscordExportTarget) -> list[Path]:
    if (target.output_dir / "manifest.json").is_file() and (
        target.output_dir / "containers"
    ).is_dir():
        return [target.output_dir]
    if not target.output_dir.is_dir():
        return []
    export_dirs = [
        child
        for child in sorted(target.output_dir.iterdir())
        if child.is_dir()
        and (child / "manifest.json").is_file()
        and (child / "containers").is_dir()
    ]
    if target.guild_ids:
        allowed = set(target.guild_ids)
        export_dirs = [path for path in export_dirs if path.name in allowed]
    if export_dirs:
        return export_dirs
    if _has_dce_flat_layout(target.output_dir):
        return [target.output_dir]
    return []


def _guild_id_from_payload(payload: dict[str, Any], fallback: str = "") -> str:
    guild_payload = payload.get("guild")
    if isinstance(guild_payload, dict):
        return str(guild_payload.get("id") or "").strip()
    if isinstance(guild_payload, str):
        return guild_payload.strip()
    return fallback


def _delete_target_rows(collection: Collection, target_name: str) -> int:
    try:
        existing: dict[str, Any] = collection.get(
            where={"source_target": target_name}, include=[]
        )
        ids: list[str] = existing.get("ids") or []
        if ids:
            collection.delete(ids=ids)
        return len(ids)
    except Exception:
        return 0


def _message_line(message: dict[str, Any]) -> str | None:
    content = _sanitize(str(message.get("content") or ""))
    if not content:
        return None
    author = message.get("author") if isinstance(message.get("author"), dict) else {}
    label = _sanitize(
        str(author.get("global_name") or author.get("username") or "member")
    )
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


def _id_set(values: set[str] | None) -> set[str]:
    return {value.strip() for value in (values or set()) if value.strip()}


def _existing_window_hashes(
    collection: Collection,
    *,
    source_target: str,
    channel_id: str,
) -> dict[str, str]:
    """Map first_message_id -> window_content_hash for an indexed channel."""
    if not source_target:
        return {}
    try:
        existing: dict[str, Any] = collection.get(
            where={
                "$and": [
                    {"source_target": source_target},
                    {"channel_id": channel_id},
                ],
            },
            include=["metadatas"],
        )
    except Exception:
        return {}
    mapping: dict[str, str] = {}
    for meta in existing.get("metadatas") or []:
        if not isinstance(meta, dict):
            continue
        first = str(meta.get("first_message_id") or "").strip()
        window_hash = str(meta.get("window_content_hash") or "").strip()
        if first and window_hash:
            mapping[first] = window_hash
    return mapping


def index_discord_export(
    collection,
    export_dir: Path,
    *,
    exclude_channel_ids: set[str] | None = None,
    include_channel_ids: set[str] | None = None,
    indexed_at: str | None = None,
    source_target: str = "",
    reconcile: bool = False,
    indexed_channels: set[str] | None = None,
) -> int:
    """Upsert Discord export JSON into Chroma (manifest/containers or DCE flat layout)."""
    exclude = _id_set(exclude_channel_ids)
    include = _id_set(include_channel_ids)
    default_guild_id = export_dir.name.strip()
    if not default_guild_id.isdigit():
        default_guild_id = ""
    target_name = source_target.strip()
    if reconcile and target_name:
        _delete_target_rows(collection, target_name)
    extra_metadata = {"indexed_at": indexed_at} if indexed_at else None
    manifest = export_dir / "manifest.json"
    containers_dir = export_dir / "containers"
    if manifest.is_file() and containers_dir.is_dir():
        container_paths = sorted(containers_dir.glob("*.json"))
    elif _has_dce_flat_layout(export_dir):
        container_paths = _dce_flat_container_paths(
            export_dir,
            include_channel_ids=include,
        )
    else:
        raise FileNotFoundError(
            f"Expected Discord export at {export_dir} "
            "(manifest.json + containers/ or DCE flat *[channel_id].json files)"
        )

    total = 0
    for path in container_paths:
        try:
            payload: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.warning(f"Skipping unreadable container payload: {path}")
            continue
        except Exception:
            logger.warning(
                "Skipping unknown container payload error: %s",
                path,
                exc_info=True,
            )
            continue
        channel = (
            payload.get("channel") if isinstance(payload.get("channel"), dict) else {}
        )
        channel_id = str(channel.get("id") or "").strip()
        if not channel_id:
            channel_id = _channel_id_from_dce_filename(path)
        if not channel_id or channel_id in exclude:
            continue
        if include and channel_id not in include:
            continue
        guild_id = _guild_id_from_payload(payload, default_guild_id)
        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            continue
        channel_name = str(channel.get("name") or "unknown-channel")
        scope = str(
            payload.get("container_scope") or channel.get("type_name") or "channel"
        )
        existing_hashes = _existing_window_hashes(
            collection,
            source_target=target_name,
            channel_id=channel_id,
        )

        lines: list[str] = []
        window: list[str] = []
        word_count = 0
        first_id: str | None = None
        last_id: str | None = None
        pending_windows: list[dict[str, Any]] = []

        def flush() -> None:
            nonlocal total, window, word_count, first_id, last_id, pending_windows
            if not window or not first_id or not last_id:
                return
            ordered_first = min(first_id, last_id, key=_snowflake_key)
            ordered_last = max(first_id, last_id, key=_snowflake_key)
            url = f"discord://channels/{channel_id}/{ordered_first}-{ordered_last}"
            host = f"discord:{channel_name}"
            markdown = _chunk_text(channel_name, scope, window)
            window_hash = _content_digest(markdown)
            if existing_hashes.get(ordered_first) == window_hash:
                window = []
                word_count = 0
                first_id = None
                last_id = None
                return
            chunks = chunk_markdown(markdown, url=url)
            chunk_meta = {
                **(extra_metadata or {}),
                "source_type": "discord",
                "source_target": target_name,
                "source_freshness_at": indexed_at
                or datetime.now(timezone.utc).isoformat(),
                "guild_id": guild_id,
                "channel_id": channel_id,
                "first_message_id": ordered_first,
                "last_message_id": ordered_last,
                "discord_jump_url": f"https://discord.com/channels/{guild_id}/{channel_id}/{ordered_first}"
                if guild_id
                else "",
                "window_content_hash": window_hash,
                "deleted": "false",
            }
            pending_windows.append(
                {
                    "url": url,
                    "host": host,
                    "source_id": ":".join(
                        part
                        for part in [DISCORD_SOURCE_ID, target_name, channel_id]
                        if part
                    ),
                    "chunks": chunks,
                    "extra_metadata": chunk_meta,
                },
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
        if pending_windows:
            total += upsert_discord_windows(collection, pending_windows)
            if indexed_channels is not None:
                indexed_channels.add(channel_id)

    return total


def index_discord_export_targets(
    collection,
    *,
    config_path: Path = DEFAULT_DISCORD_EXPORT_TARGETS_CONFIG,
    exclude_channel_ids: set[str] | None = None,
    indexed_at: str | None = None,
    reconcile: bool = True,
) -> list[DiscordTargetIndexResult]:
    targets = load_discord_export_targets(config_path)
    results: list[DiscordTargetIndexResult] = []
    for target in targets:
        if not target.enabled:
            results.append(
                DiscordTargetIndexResult(
                    target=target.name,
                    enabled=False,
                    skipped_reason=target.disabled_reason or "target disabled",
                    export_dir=str(target.output_dir),
                ),
            )
            continue
        export_dirs: list[Path] = _resolve_export_dirs(target)
        if not export_dirs:
            results.append(
                DiscordTargetIndexResult(
                    target=target.name,
                    enabled=True,
                    skipped_reason=(
                        f"no Discord export archive found at {target.output_dir} "
                        "(expected manifest.json + containers/ or DCE flat *[channel_id].json)"
                    ),
                    export_dir=str(target.output_dir),
                ),
            )
            continue
        if reconcile:
            _delete_target_rows(collection, target.name)
        chunks = 0
        channels_indexed: set[str] = set()
        include_channels = set(target.channel_ids) if target.channel_ids else None
        for export_dir in export_dirs:
            chunks += index_discord_export(
                collection,
                export_dir,
                exclude_channel_ids=set(exclude_channel_ids or set()),
                include_channel_ids=include_channels,
                indexed_at=indexed_at,
                source_target=target.name,
                reconcile=False,
                indexed_channels=channels_indexed,
            )
        degraded_reason = ""
        if chunks == 0:
            if target.channel_ids:
                degraded_reason = (
                    "enabled target indexed 0 chunks for allowlisted channel_ids "
                    f"{list(target.channel_ids)} — check export path and layout"
                )
            else:
                degraded_reason = (
                    "enabled target indexed 0 chunks — export tree may be empty or unreadable"
                )
        results.append(
            DiscordTargetIndexResult(
                target=target.name,
                enabled=True,
                chunks_indexed=chunks,
                channels_indexed=len(channels_indexed),
                degraded_reason=degraded_reason,
                export_dir=str(target.output_dir),
            ),
        )
    return results
