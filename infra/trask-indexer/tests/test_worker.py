from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest

from trask_indexer.worker import (
    drain_reindex_queue,
    empty_queue_state,
    load_queue_state,
    queue_lock,
    save_queue_state,
)


def _write_allowlist(data_dir: Path) -> None:
    allowlist = data_dir / "allowlist.json"
    allowlist.write_text(
        """{
  "baseHosts": ["example.com"],
  "urlPrefixes": ["https://example.com/"],
  "sources": [
    {"id": "ex", "homeUrl": "https://example.com/docs", "name": "Example"}
  ]
}""",
        encoding="utf-8",
    )


def test_load_queue_state_missing_file(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("INGEST_STATE_DIR", str(tmp_path))
    state = load_queue_state()
    assert state.queued_source_ids == []


def test_load_queue_state_corrupt_file(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("INGEST_STATE_DIR", str(tmp_path))
    queue_path = tmp_path / "reindex-queue.json"
    queue_path.write_text("{bad json", encoding="utf-8")
    state = load_queue_state()
    assert state.queued_source_ids == []
    assert not queue_path.exists()
    assert any(path.name.startswith("reindex-queue.json.corrupt.") for path in tmp_path.iterdir())


def test_save_and_load_roundtrip(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("INGEST_STATE_DIR", str(tmp_path))
    save_queue_state(empty_queue_state().__class__(version=1, queued_source_ids=["a", "b"]))
    loaded = load_queue_state()
    assert loaded.queued_source_ids == ["a", "b"]


def test_drain_reindex_queue_empty(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("INGEST_STATE_DIR", str(tmp_path))
    result = drain_reindex_queue(data_dir=tmp_path / "indexer")
    assert result.dequeued_source_ids == []
    assert result.crawl is None


def test_drain_reindex_queue_dry_run(tmp_path: Path, monkeypatch):
    ingest_dir = tmp_path / "ingest"
    indexer_dir = tmp_path / "indexer"
    ingest_dir.mkdir()
    indexer_dir.mkdir()
    _write_allowlist(indexer_dir)
    monkeypatch.setenv("INGEST_STATE_DIR", str(ingest_dir))

    queue_path = ingest_dir / "reindex-queue.json"
    queue_path.write_text(
        json.dumps({"version": 1, "queuedSourceIds": ["ex"]}),
        encoding="utf-8",
    )

    result = drain_reindex_queue(dry_run=True, data_dir=indexer_dir)
    assert result.dequeued_source_ids == ["ex"]
    assert result.crawl is not None
    assert result.crawl.dry_run is True
    assert result.crawl.attempted == 1

    # dry_run should not clear queue
    loaded = load_queue_state()
    assert loaded.queued_source_ids == ["ex"]


def test_drain_reindex_queue_clears_queue_on_live_drain(tmp_path: Path, monkeypatch):
    ingest_dir = tmp_path / "ingest"
    indexer_dir = tmp_path / "indexer"
    ingest_dir.mkdir()
    indexer_dir.mkdir()
    _write_allowlist(indexer_dir)
    monkeypatch.setenv("INGEST_STATE_DIR", str(ingest_dir))

    queue_path = ingest_dir / "reindex-queue.json"
    queue_path.write_text(
        json.dumps({"version": 1, "queuedSourceIds": ["ex"]}),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        "trask_indexer.worker.run_batch_crawl",
        lambda **kwargs: type("R", (), {"attempted": 1, "indexed": 1, "failed": 0, "dry_run": False})(),
    )

    result = drain_reindex_queue(dry_run=False, data_dir=indexer_dir)
    assert result.dequeued_source_ids == ["ex"]
    loaded = load_queue_state()
    assert loaded.queued_source_ids == []


def test_queue_lock_recovers_stale_lock(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("INGEST_STATE_DIR", str(tmp_path))
    lock_path = tmp_path / "reindex-queue.lock"
    lock_path.write_text("held", encoding="utf-8")
    stale = time.time() - (6 * 60)
    os.utime(lock_path, (stale, stale))

    with queue_lock():
        assert lock_path.exists()


def test_queue_lock_timeout_on_fresh_lock(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("INGEST_STATE_DIR", str(tmp_path))
    lock_path = tmp_path / "reindex-queue.lock"
    lock_path.write_text("held", encoding="utf-8")

    monkeypatch.setattr("trask_indexer.worker.LOCK_TIMEOUT_MS", 50)
    monkeypatch.setattr("trask_indexer.worker.LOCK_RETRY_MS", 0.01)

    with pytest.raises(TimeoutError):
        with queue_lock():
            pass
