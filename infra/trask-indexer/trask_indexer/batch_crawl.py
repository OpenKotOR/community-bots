"""Batch crawl allowlisted catalog seeds into Chroma."""

from __future__ import annotations

import json
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse

from trask_indexer.allowlist import AllowlistCatalog, default_allowlist_path, load_allowlist
from trask_indexer.chunk import chunk_markdown
from trask_indexer.chroma_store import (
    DEFAULT_COLLECTION,
    get_chroma_client,
    get_or_create_collection,
    upsert_chunks,
)
from trask_indexer.crawl import crawl_url

LOG = logging.getLogger("trask.batch_crawl")


def _data_dir() -> Path:
    return Path(os.environ.get("TRASK_INDEXER_DATA_DIR", "data/trask-indexer"))


def resolve_source_id(catalog: AllowlistCatalog, url: str) -> str:
    normalized = url.rstrip("/")
    for source in catalog.sources:
        if normalized.startswith(source.home_url.rstrip("/")):
            return source.id
    host = urlparse(url).hostname or "source"
    return host


def index_markdown_page(
    collection,
    *,
    url: str,
    markdown: str,
    source_id: str,
) -> int:
    """Chunk markdown and upsert into Chroma. Returns chunk count (0 if skipped)."""
    host = urlparse(url).hostname or "source"
    chunks = chunk_markdown(markdown, url=url)
    if not chunks:
        return 0
    upsert_chunks(collection, url=url, host=host, source_id=source_id, chunks=chunks)
    return len(chunks)


def crawl_and_index_url(collection, catalog: AllowlistCatalog, url: str, *, source_id: str | None = None) -> dict:
    """Crawl one URL and upsert chunks. Returns a result dict for operator logs."""
    sid = source_id or resolve_source_id(catalog, url)
    page = crawl_url(url)
    if not page.success or not page.markdown.strip():
        return {
            "url": url,
            "source_id": sid,
            "ok": False,
            "error": page.error or "empty markdown",
            "chunks": 0,
        }
    count = index_markdown_page(collection, url=url, markdown=page.markdown, source_id=sid)
    if count == 0:
        return {
            "url": url,
            "source_id": sid,
            "ok": False,
            "error": "no chunks",
            "chunks": 0,
        }
    return {"url": url, "source_id": sid, "ok": True, "error": None, "chunks": count}


@dataclass(frozen=True)
class BatchCrawlResult:
    attempted: int
    indexed: int
    failed: int
    dry_run: bool


def iter_seed_targets(
    catalog: AllowlistCatalog,
    *,
    source_ids: set[str] | None = None,
    limit: int | None = None,
) -> list[tuple[str, str]]:
    """Return (source_id, home_url) pairs in catalog order."""
    out: list[tuple[str, str]] = []
    for source in catalog.sources:
        if source_ids and source.id not in source_ids:
            continue
        url = source.home_url.rstrip("/")
        if not catalog.is_approved_url(url):
            LOG.warning("skip unapproved seed source=%s url=%s", source.id, url)
            continue
        out.append((source.id, url))
        if limit is not None and len(out) >= limit:
            break
    return out


def run_batch_crawl(
    *,
    source_ids: set[str] | None = None,
    limit: int | None = None,
    dry_run: bool = False,
    data_dir: Path | None = None,
) -> BatchCrawlResult:
    root = data_dir or _data_dir()
    allowlist_path = default_allowlist_path(root)
    if not allowlist_path.is_file():
        raise FileNotFoundError(f"allowlist not found: {allowlist_path}")

    catalog = load_allowlist(allowlist_path)
    targets = iter_seed_targets(catalog, source_ids=source_ids, limit=limit)
    if dry_run:
        for sid, url in targets:
            print(json.dumps({"dry_run": True, "source_id": sid, "url": url}), flush=True)
        return BatchCrawlResult(attempted=len(targets), indexed=0, failed=0, dry_run=True)

    persist_dir = root / "chroma"
    client = get_chroma_client(persist_dir)
    collection = get_or_create_collection(client, DEFAULT_COLLECTION)

    indexed = 0
    failed = 0
    for sid, url in targets:
        LOG.info("batch_crawl fetching source=%s url=%s", sid, url)
        result = crawl_and_index_url(collection, catalog, url, source_id=sid)
        print(json.dumps(result), flush=True)
        if result["ok"]:
            indexed += 1
        else:
            failed += 1

    return BatchCrawlResult(attempted=len(targets), indexed=indexed, failed=failed, dry_run=False)
