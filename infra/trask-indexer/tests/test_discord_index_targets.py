from __future__ import annotations

import json
from pathlib import Path

from trask_indexer.discord_index import index_discord_export, index_discord_export_targets, load_discord_export_targets


def _write_targets(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "defaults": {"refresh_interval_seconds": 3600},
                "targets": [
                    {
                        "name": "openkotor",
                        "output_dir": str(path.parent / "openkotor"),
                        "guild_ids": ["123"],
                        "channel_ids": ["456"],
                    },
                    {
                        "name": "private_staff",
                        "enabled": False,
                        "output_dir": str(path.parent / "private_staff"),
                        "disabled_reason": "staff channels are not indexed by default",
                    },
                ],
            },
        ),
        encoding="utf-8",
    )


def test_load_discord_export_targets_parses_operator_config(tmp_path: Path):
    config_path = tmp_path / "scrape-targets.json"
    _write_targets(config_path)

    targets = load_discord_export_targets(config_path)

    assert [target.name for target in targets] == ["openkotor", "private_staff"]
    assert targets[0].enabled is True
    assert targets[0].guild_ids == ("123",)
    assert targets[0].channel_ids == ("456",)
    assert targets[0].refresh_interval_seconds == 3600
    assert targets[1].enabled is False
    assert targets[1].disabled_reason == "staff channels are not indexed by default"


def test_index_discord_export_targets_reports_disabled_and_missing_archives(tmp_path: Path):
    config_path = tmp_path / "scrape-targets.json"
    _write_targets(config_path)

    results = index_discord_export_targets(object(), config_path=config_path, indexed_at="2026-06-11T00:00:00+00:00")

    assert results[0].target == "openkotor"
    assert results[0].enabled is True
    assert "no DiscordChatExporter archive found" in results[0].skipped_reason
    assert results[1].target == "private_staff"
    assert results[1].enabled is False
    assert results[1].skipped_reason == "staff channels are not indexed by default"


def test_index_discord_export_uses_target_channel_ids_as_allowlist(tmp_path: Path, monkeypatch):
    export_dir = tmp_path / "123"
    containers = export_dir / "containers"
    containers.mkdir(parents=True)
    (export_dir / "manifest.json").write_text("{}", encoding="utf-8")

    allowed_payload = {
        "channel": {"id": "456", "name": "allowed", "type_name": "GuildText"},
        "messages": [{"id": "1", "content": "allowed message"}],
    }
    blocked_payload = {
        "channel": {"id": "999", "name": "blocked", "type_name": "GuildText"},
        "messages": [{"id": "2", "content": "blocked message"}],
    }
    (containers / "456.json").write_text(json.dumps(allowed_payload), encoding="utf-8")
    (containers / "999.json").write_text(json.dumps(blocked_payload), encoding="utf-8")

    indexed_channels: list[str] = []

    def fake_upsert_discord_windows(collection, windows):
        del collection
        for window in windows:
            meta = window.get("extra_metadata") or {}
            if meta.get("channel_id"):
                indexed_channels.append(str(meta["channel_id"]))
        return sum(len(window["chunks"]) for window in windows)

    monkeypatch.setattr(
        "trask_indexer.discord_index.upsert_discord_windows",
        fake_upsert_discord_windows,
    )
    monkeypatch.setattr("trask_indexer.discord_index._existing_window_hashes", lambda *_args, **_kwargs: {})

    count = index_discord_export(
        object(),
        export_dir,
        include_channel_ids={"456"},
        source_target="openkotor",
    )

    assert count > 0
    assert indexed_channels
    assert all(channel_id == "456" for channel_id in indexed_channels)


def _write_export_container(
    export_dir: Path,
    *,
    channel_id: str = "456",
    message_id: str = "1",
    content: str = "allowed message",
) -> None:
    containers = export_dir / "containers"
    containers.mkdir(parents=True, exist_ok=True)
    (export_dir / "manifest.json").write_text("{}", encoding="utf-8")
    payload = {
        "channel": {"id": channel_id, "name": "allowed", "type_name": "GuildText"},
        "messages": [{"id": message_id, "content": content}],
    }
    (containers / f"{channel_id}.json").write_text(json.dumps(payload), encoding="utf-8")


def test_index_discord_export_skips_unchanged_window_hash(tmp_path: Path, monkeypatch):
    export_dir = tmp_path / "123"
    _write_export_container(export_dir)

    class FakeCollection:
        def __init__(self) -> None:
            self.get_calls = 0
            self.upsert_calls = 0

        def get(self, **_kwargs):
            self.get_calls += 1
            return {
                "metadatas": [
                    {
                        "first_message_id": "1",
                        "window_content_hash": "unchanged-hash",
                    },
                ],
            }

    collection = FakeCollection()
    upsert_invocations: list[int] = []

    def fake_upsert_discord_windows(_collection, windows):
        upsert_invocations.append(len(windows))
        return sum(len(window["chunks"]) for window in windows)

    monkeypatch.setattr(
        "trask_indexer.discord_index._content_digest",
        lambda _value: "unchanged-hash",
    )
    monkeypatch.setattr(
        "trask_indexer.discord_index.upsert_discord_windows",
        fake_upsert_discord_windows,
    )

    count = index_discord_export(
        collection,
        export_dir,
        include_channel_ids={"456"},
        source_target="openkotor",
        reconcile=False,
    )

    assert count == 0
    assert upsert_invocations == []
    assert collection.get_calls >= 1


def test_index_discord_export_reindexes_when_window_hash_changes(tmp_path: Path, monkeypatch):
    export_dir = tmp_path / "123"
    _write_export_container(export_dir, content="edited message")

    class FakeCollection:
        def get(self, **_kwargs):
            return {
                "metadatas": [
                    {
                        "first_message_id": "1",
                        "window_content_hash": "stale-hash",
                    },
                ],
            }

    upsert_invocations: list[int] = []

    def fake_upsert_discord_windows(_collection, windows):
        upsert_invocations.append(len(windows))
        return sum(len(window["chunks"]) for window in windows)

    monkeypatch.setattr(
        "trask_indexer.discord_index._content_digest",
        lambda _value: "fresh-hash",
    )
    monkeypatch.setattr(
        "trask_indexer.discord_index.upsert_discord_windows",
        fake_upsert_discord_windows,
    )

    count = index_discord_export(
        FakeCollection(),
        export_dir,
        include_channel_ids={"456"},
        source_target="openkotor",
        reconcile=False,
    )

    assert count > 0
    assert upsert_invocations == [1]
