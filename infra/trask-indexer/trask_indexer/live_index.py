"""Bounded live Crawl4AI fetch → chunk → embed → Chroma upsert for retrieve misses."""

from __future__ import annotations

import logging
import os
import re
from pathlib import Path

from trask_indexer.allowlist import AllowlistCatalog, default_allowlist_path, load_allowlist
from trask_indexer.batch_crawl import crawl_and_index_url, resolve_source_id
from trask_indexer.chroma_store import (
    DEFAULT_COLLECTION,
    get_chroma_client,
    get_or_create_collection,
    query_passages,
)

LOG = logging.getLogger("trask.live_index")

_TOKEN_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)
DEFAULT_MAX_URLS = 5


def _tokenize(text: str) -> set[str]:
    return {t for t in _TOKEN_RE.findall(text.lower()) if len(t) > 2}


def _score_source(query_tokens: set[str], *, name: str, home_url: str) -> float:
    haystack = f"{name} {home_url}".lower()
    hits = sum(1 for token in query_tokens if token in haystack)
    return hits + (0.5 if hits else 0.0)


def pick_live_crawl_urls(
    catalog: AllowlistCatalog,
    query: str,
    *,
    max_urls: int = DEFAULT_MAX_URLS,
    extra_urls: list[str] | None = None,
) -> list[str]:
    """Rank allowlisted seed URLs by query token overlap."""
    query_tokens = _tokenize(query)
    scored: list[tuple[float, str]] = []
    seen: set[str] = set()

    for source in catalog.sources:
        url = source.home_url.rstrip("/")
        if not catalog.is_approved_url(url):
            continue
        score = _score_source(query_tokens, name=source.name, home_url=url)
        if url not in seen:
            scored.append((score, url))
            seen.add(url)

    for url in extra_urls or []:
        normalized = url.strip().rstrip("/")
        if not normalized or normalized in seen:
            continue
        if catalog.is_approved_url(normalized):
            scored.append((_score_source(query_tokens, name="", home_url=normalized) + 0.25, normalized))
            seen.add(normalized)

    scored.sort(key=lambda pair: pair[0], reverse=True)
    chosen = [url for score, url in scored if score > 0][:max_urls]
    if chosen:
        return chosen

    # No token overlap — crawl top allowlisted hosts so RAG still has material.
    fallback = [source.home_url.rstrip("/") for source in catalog.sources[:max_urls]]
    return list(dict.fromkeys(fallback))


def _indexer_data_dir() -> Path:
    return Path(os.environ.get("TRASK_INDEXER_DATA_DIR", "data/trask-indexer"))


def live_crawl_and_index(
    query: str,
    *,
    max_urls: int = DEFAULT_MAX_URLS,
    extra_urls: list[str] | None = None,
) -> list[dict]:
    """
    Crawl up to `max_urls` allowlisted pages, upsert into Chroma, return passage dicts.
    """
    data_dir = _indexer_data_dir()
    allowlist_path = default_allowlist_path(data_dir)
    if not allowlist_path.is_file():
        LOG.warning("live_crawl skipped missing allowlist %s", allowlist_path)
        return []

    catalog = load_allowlist(allowlist_path)
    urls = pick_live_crawl_urls(catalog, query, max_urls=max_urls, extra_urls=extra_urls)
    if not urls:
        LOG.info("live_crawl no candidate urls for query=%r", query[:80])
        return []

    persist_dir = data_dir / "chroma"
    client = get_chroma_client(persist_dir)
    collection = get_or_create_collection(client, DEFAULT_COLLECTION)

    indexed_urls: list[str] = []
    for url in urls:
        LOG.info("live_crawl fetching %s", url)
        source_id = resolve_source_id(catalog, url)
        result = crawl_and_index_url(collection, catalog, url, source_id=source_id)
        if not result["ok"]:
            LOG.warning("live_crawl failed url=%s error=%s", url, result.get("error"))
            continue
        indexed_urls.append(url)
        LOG.info("live_crawl indexed url=%s chunks=%s", url, result["chunks"])

    if not indexed_urls:
        return []

    hits = query_passages(collection, query, limit=12)
    out: list[dict] = []
    for hit in hits:
        out.append(
            {
                "id": hit.id,
                "url": hit.url,
                "host": hit.host,
                "quote": hit.quote,
                "score": hit.score,
                "sourceId": hit.source_id,
                "guildId": hit.guild_id,
                "channelId": hit.channel_id,
                "firstMessageId": hit.first_message_id,
            }
        )
    LOG.info("live_crawl retrieve passages=%s indexed_urls=%s", len(out), len(indexed_urls))
    return out


def live_crawl_enabled() -> bool:
    raw = os.environ.get("TRASK_WEB_RESEARCH_LIVE_CRAWL", "0").strip().lower()
    return raw in ("1", "true", "yes", "on")


def should_live_crawl(passages: list[dict], *, min_passages: int = 2) -> bool:
    if not passages:
        return True
    if len(passages) < min_passages:
        return True
    return False
