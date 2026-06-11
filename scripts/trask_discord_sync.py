#!/usr/bin/env python3
"""
Export readable Discord channels and upsert into Trask Chroma.

Env:
  TRASK_DISCORD_BOT_TOKEN (required)
  TRASK_ALLOWED_GUILD_IDS (optional, comma-separated; all are synced)
  TRASK_DISCORD_CHANNEL_BLACKLIST (optional, channel IDs to skip)
  TRASK_INDEXER_DATA_DIR (default data/trask-indexer)
  TRASK_DISCORD_EXPORT_DIR (default data/trask-discord-export)
  TRASK_DISCORD_EXPORT_TARGETS_CONFIG (default data/trask/discord-export-targets.json)
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
INDEXER_SRC = REPO_ROOT / "infra" / "trask-indexer"


def _list_env(name: str) -> list[str]:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def _resolve_guild_ids() -> list[str]:
    guilds = _list_env("TRASK_ALLOWED_GUILD_IDS")
    if guilds:
        return guilds
    single = (
        os.environ.get("TRASK_DISCORD_GUILD_ID", "").strip()
        or os.environ.get("DISCORD_TARGET_GUILD_ID", "").strip()
    )
    return [single] if single else []


DEFAULT_EXPORT_TARGETS_CONFIG = REPO_ROOT / "data/trask/discord-export-targets.json"


def _write_sync_status(
    data_dir: Path,
    *,
    guild_ids: list[str],
    chunk_count: int,
    target_results: list[dict] | None = None,
) -> None:
    status_path = data_dir / "discord_sync_status.json"
    status_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "last_discord_sync": datetime.now(timezone.utc).isoformat(),
        "guild_ids": guild_ids,
        "chunk_count": chunk_count,
        "targets": target_results or [],
    }
    status_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> int:
    token = os.environ.get("TRASK_DISCORD_BOT_TOKEN", "").strip()
    export_root = Path(os.environ.get("TRASK_DISCORD_EXPORT_DIR", REPO_ROOT / "data/trask-discord-export"))
    export_root.mkdir(parents=True, exist_ok=True)
    targets_config = Path(os.environ.get("TRASK_DISCORD_EXPORT_TARGETS_CONFIG", DEFAULT_EXPORT_TARGETS_CONFIG))
    use_archive_targets = targets_config.is_file() and os.environ.get("TRASK_DISCORD_SYNC_USE_EXPORT_TARGETS", "1").strip() != "0"
    blacklist = set(_list_env("TRASK_DISCORD_CHANNEL_BLACKLIST"))

    if str(INDEXER_SRC) not in sys.path:
        sys.path.insert(0, str(INDEXER_SRC))

    from trask_indexer.chroma_store import (  # type: ignore[import-not-found]
        DEFAULT_COLLECTION,
        get_chroma_client,
        get_or_create_collection,
    )
    from trask_indexer.discord_index import (  # type: ignore[import-not-found]
        index_discord_export,
        index_discord_export_targets,
    )

    data_dir = Path(os.environ.get("TRASK_INDEXER_DATA_DIR", REPO_ROOT / "data/trask-indexer"))
    persist_dir = data_dir / "chroma"
    client = get_chroma_client(persist_dir)
    collection = get_or_create_collection(client, DEFAULT_COLLECTION)

    indexed_at = datetime.now(timezone.utc).isoformat()
    total_chunks = 0
    guild_ids = _resolve_guild_ids()

    if use_archive_targets:
        print(f"Indexing DiscordChatExporter targets from {targets_config}", flush=True)
        results = index_discord_export_targets(
            collection,
            config_path=targets_config,
            exclude_channel_ids=blacklist,
            indexed_at=indexed_at,
            reconcile=True,
        )
        target_results: list[dict] = []
        for result in results:
            target_results.append(
                {
                    "target": result.target,
                    "enabled": result.enabled,
                    "skipped_reason": result.skipped_reason,
                    "chunks_indexed": result.chunks_indexed,
                    "export_dir": result.export_dir,
                }
            )
            if result.skipped_reason:
                print(f"Target {result.target}: skipped ({result.skipped_reason})", flush=True)
            else:
                print(f"Target {result.target}: indexed {result.chunks_indexed} chunks", flush=True)
            total_chunks += result.chunks_indexed

        print(
            f"Indexed {total_chunks} Discord chunks total into {DEFAULT_COLLECTION} at {indexed_at}",
            flush=True,
        )
        _write_sync_status(data_dir, guild_ids=guild_ids, chunk_count=total_chunks, target_results=target_results)
        return 0

    if not token:
        print("TRASK_DISCORD_BOT_TOKEN is required when DiscordChatExporter targets mode is disabled", file=sys.stderr)
        return 1

    if not guild_ids:
        print("Set TRASK_ALLOWED_GUILD_IDS or TRASK_DISCORD_GUILD_ID for Discord export", file=sys.stderr)
        return 1

    export_script = REPO_ROOT / "scripts" / "export_discord_server.py"
    if not export_script.is_file():
        print(f"Missing {export_script}", file=sys.stderr)
        return 1

    for guild_id in guild_ids:
        guild_export = export_root / guild_id
        guild_export.mkdir(parents=True, exist_ok=True)

        cmd = [
            sys.executable,
            "-B",
            str(export_script),
            "--token",
            token,
            "--guild-id",
            guild_id,
            "--output-dir",
            str(guild_export),
        ]
        for channel_id in sorted(blacklist):
            cmd.extend(["--exclude-channel", channel_id])

        print(f"Exporting guild {guild_id} → {guild_export}", flush=True)
        subprocess.run(cmd, check=True, cwd=REPO_ROOT)

        count = index_discord_export(
            collection,
            guild_export,
            exclude_channel_ids=blacklist,
            indexed_at=indexed_at,
        )
        total_chunks += count
        print(f"Guild {guild_id}: indexed {count} Discord chunks", flush=True)

    print(
        f"Indexed {total_chunks} Discord chunks total into {DEFAULT_COLLECTION} at {indexed_at}",
        flush=True,
    )
    _write_sync_status(data_dir, guild_ids=guild_ids, chunk_count=total_chunks)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
