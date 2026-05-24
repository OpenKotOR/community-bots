from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pytest

from trask_indexer.worker import (
    DEFAULT_QUEUE_POLL_MS,
    DrainQueueResult,
    MAX_QUEUE_POLL_MS,
    MIN_QUEUE_POLL_MS,
    drain_reindex_queue,
    empty_queue_state,
    load_queue_state,
    parse_queue_poll_ms,
    queue_lock,
    run_queue_worker,
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


def test_parse_queue_poll_ms_defaults_and_clamps():
    assert parse_queue_poll_ms(None) == DEFAULT_QUEUE_POLL_MS
    assert parse_queue_poll_ms("500") == MIN_QUEUE_POLL_MS
    assert parse_queue_poll_ms("999999") == MAX_QUEUE_POLL_MS
    assert parse_queue_poll_ms("30000") == 30_000
    assert parse_queue_poll_ms("not-a-number") == DEFAULT_QUEUE_POLL_MS


def test_run_queue_worker_runs_one_cycle_before_interrupt(monkeypatch):
    calls: list[bool] = []

    def fake_drain(**kwargs):
        calls.append(True)
        return DrainQueueResult(dequeued_source_ids=[], crawl=None)

    def fake_sleep(_seconds: float) -> None:
        raise KeyboardInterrupt

    monkeypatch.setattr("trask_indexer.worker.drain_reindex_queue", fake_drain)
    monkeypatch.setattr("trask_indexer.worker.time.sleep", fake_sleep)

    with pytest.raises(KeyboardInterrupt):
        run_queue_worker(poll_ms=2000)

    assert calls == [True]
