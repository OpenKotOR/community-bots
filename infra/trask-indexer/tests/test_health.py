from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from trask_indexer.chroma_store import DEFAULT_COLLECTION
from trask_indexer.health import build_health_payload


def _write_status(data_dir: Path, *, iso_timestamp: str) -> None:
    path = data_dir / "discord_sync_status.json"
    path.write_text(
        json.dumps({"last_discord_sync": iso_timestamp, "guild_ids": ["1"], "chunk_count": 3}),
        encoding="utf-8",
    )


def test_health_without_status_file(tmp_path: Path):
    payload = build_health_payload(tmp_path, collection=DEFAULT_COLLECTION)
    assert payload == {"ok": True, "collection": DEFAULT_COLLECTION}


def test_health_fresh_discord_sync(tmp_path: Path):
    now = datetime(2026, 5, 24, 12, 0, tzinfo=timezone.utc)
    _write_status(tmp_path, iso_timestamp="2026-05-24T11:00:00+00:00")
    payload = build_health_payload(tmp_path, collection=DEFAULT_COLLECTION, now=now)
    assert payload["discord_sync_stale"] is False
    assert payload["discord_sync_age_hours"] == 1.0


def test_health_stale_discord_sync(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("TRASK_DISCORD_SYNC_STALE_HOURS", "24")
    now = datetime(2026, 5, 24, 12, 0, tzinfo=timezone.utc)
    _write_status(tmp_path, iso_timestamp="2026-05-22T12:00:00+00:00")
    payload = build_health_payload(tmp_path, collection=DEFAULT_COLLECTION, now=now)
    assert payload["discord_sync_stale"] is True
    assert payload["discord_sync_stale_after_hours"] == 24.0
    assert payload["discord_sync_age_hours"] == 48.0
