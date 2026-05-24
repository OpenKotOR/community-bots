"""Drain shared reindex queue into Chroma via Crawl4AI batch crawl."""

from __future__ import annotations

import json
import logging
import os
import time
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from trask_indexer.batch_crawl import BatchCrawlResult, run_batch_crawl

LOG = logging.getLogger("trask.worker")

LOCK_TIMEOUT_MS = 5_000
LOCK_RETRY_MS = 0.05
LOCK_STALE_MS = 5 * 60

@dataclass(frozen=True)
class ReindexQueueState:
    version: int
    queued_source_ids: list[str]


@dataclass(frozen=True)
class DrainQueueResult:
    dequeued_source_ids: list[str]
    crawl: BatchCrawlResult | None


def empty_queue_state() -> ReindexQueueState:
    return ReindexQueueState(version=1, queued_source_ids=[])


def ingest_state_dir() -> Path:
    return Path(os.environ.get("INGEST_STATE_DIR", "data/ingest-worker"))


def queue_file_path(state_dir: Path | None = None) -> Path:
    root = state_dir or ingest_state_dir()
    return root / "reindex-queue.json"


def queue_lock_path(state_dir: Path | None = None) -> Path:
    root = state_dir or ingest_state_dir()
    return root / "reindex-queue.lock"


def load_queue_state(state_dir: Path | None = None) -> ReindexQueueState:
    path = queue_file_path(state_dir)
    if not path.is_file():
        return empty_queue_state()

    try:
        raw = path.read_text(encoding="utf-8")
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        quarantine = path.with_name(f"{path.name}.corrupt.{int(time.time() * 1000)}")
        path.rename(quarantine)
        LOG.warning("quarantined corrupt queue file: %s", quarantine)
        return empty_queue_state()

    version = parsed.get("version")
    queued = parsed.get("queuedSourceIds")
    if version != 1 or not isinstance(queued, list):
        quarantine = path.with_name(f"{path.name}.corrupt.{int(time.time() * 1000)}")
        path.rename(quarantine)
        LOG.warning("quarantined invalid queue file: %s", quarantine)
        return empty_queue_state()

    ids = [str(entry).strip() for entry in queued if str(entry).strip()]
    return ReindexQueueState(version=1, queued_source_ids=ids)


def save_queue_state(state: ReindexQueueState, state_dir: Path | None = None) -> None:
    root = state_dir or ingest_state_dir()
    root.mkdir(parents=True, exist_ok=True)
    path = queue_file_path(root)
    temp_path = path.with_name(f"{path.name}.{os.getpid()}.{int(time.time() * 1000)}.tmp")
    payload = {"version": state.version, "queuedSourceIds": state.queued_source_ids}
    temp_path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    temp_path.replace(path)


@contextmanager
def queue_lock(state_dir: Path | None = None) -> Iterator[None]:
    root = state_dir or ingest_state_dir()
    root.mkdir(parents=True, exist_ok=True)
    lock_path = queue_lock_path(root)
    deadline = time.monotonic() + (LOCK_TIMEOUT_MS / 1000.0)
    lock_fd: int | None = None

    while True:
        try:
            lock_fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            break
        except FileExistsError:
            try:
                age_s = time.time() - lock_path.stat().st_mtime
                if age_s >= LOCK_STALE_MS:
                    lock_path.unlink(missing_ok=True)
                    continue
            except FileNotFoundError:
                continue

            if time.monotonic() >= deadline:
                raise TimeoutError("Timed out waiting for reindex queue lock.")

            time.sleep(LOCK_RETRY_MS)

    try:
        yield
    finally:
        if lock_fd is not None:
            os.close(lock_fd)
        lock_path.unlink(missing_ok=True)


def dequeue_all(state_dir: Path | None = None) -> list[str]:
    root = state_dir or ingest_state_dir()
    with queue_lock(root):
        state = load_queue_state(root)
        queued = list(state.queued_source_ids)
        save_queue_state(empty_queue_state(), root)
        return queued


def drain_reindex_queue(
    *,
    dry_run: bool = False,
    state_dir: Path | None = None,
    data_dir: Path | None = None,
) -> DrainQueueResult:
    """Drain queued catalog source ids and crawl them into Chroma."""
    root = state_dir or ingest_state_dir()
    with queue_lock(root):
        state = load_queue_state(root)
        queued = list(state.queued_source_ids)
        if not dry_run:
            save_queue_state(empty_queue_state(), root)

    if not queued:
        LOG.info("reindex queue empty")
        return DrainQueueResult(dequeued_source_ids=[], crawl=None)

    LOG.info("draining %d queued source id(s): %s", len(queued), ", ".join(queued))
    crawl = run_batch_crawl(
        source_ids=set(queued),
        dry_run=dry_run,
        data_dir=data_dir,
    )
    return DrainQueueResult(dequeued_source_ids=queued, crawl=crawl)
