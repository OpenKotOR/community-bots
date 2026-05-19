"""
Redis cache for Trask web research (DuckDuckGo discovery + page scrape).

Optional: set REDIS_URL or TRASK_REDIS_URL. Disable with TRASK_CACHE_DISABLED=1.

Key layout (redis-development plugin conventions):
  trask:search:{hash}     — discovered URL list (JSON)
  trask:page:{hash}       — scraped markdown per normalized URL
  trask:research:{hash}   — full run_payload JSON result

All keys use SETEX with configurable TTLs.
"""

from __future__ import annotations

import hashlib
import json
import os
from typing import Any, TYPE_CHECKING

if TYPE_CHECKING:
    from redis import Redis

KEY_PREFIX = "trask"

DEFAULT_SEARCH_TTL = 6 * 60 * 60  # 6h — DDG results drift slowly
DEFAULT_PAGE_TTL = 7 * 24 * 60 * 60  # 7d — archive pages are fairly stable
DEFAULT_RESEARCH_TTL = 60 * 60  # 1h — full answer bundle; shorter for freshness


def cache_enabled() -> bool:
    if os.environ.get("TRASK_CACHE_DISABLED", "").strip().lower() in ("1", "true", "yes"):
        return False
    return bool(_redis_url())


def _redis_url() -> str | None:
    return os.environ.get("TRASK_REDIS_URL") or os.environ.get("REDIS_URL")


def _ttl(env_name: str, default: int) -> int:
    raw = os.environ.get(env_name, "").strip()
    if not raw:
        return default
    try:
        return max(60, int(raw))
    except ValueError:
        return default


def search_ttl() -> int:
    return _ttl("TRASK_CACHE_SEARCH_TTL_SECONDS", DEFAULT_SEARCH_TTL)


def page_ttl() -> int:
    return _ttl("TRASK_CACHE_PAGE_TTL_SECONDS", DEFAULT_PAGE_TTL)


def research_ttl() -> int:
    return _ttl("TRASK_CACHE_RESEARCH_TTL_SECONDS", DEFAULT_RESEARCH_TTL)


def get_client() -> Redis | None:
    if not cache_enabled():
        return None
    url = _redis_url()
    if not url:
        return None
    try:
        import redis
    except ImportError:
        return None
    return redis.from_url(url, decode_responses=True)


def ping(client: Redis) -> bool:
    try:
        return bool(client.ping())
    except Exception:
        return False


def _sha(parts: list[str]) -> str:
    payload = "\x1f".join(parts).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _key(kind: str, digest: str) -> str:
    return f"{KEY_PREFIX}:{kind}:{digest}"


def _normalize_url(url: str) -> str:
    return url.strip().rstrip("/").lower()


def search_cache_key(query: str, query_domains: list[str]) -> str:
    domains = "|".join(sorted(d.strip().lower() for d in query_domains if d.strip()))
    return _key("search", _sha([query.strip().lower(), domains]))


def page_cache_key(url: str) -> str:
    return _key("page", _sha([_normalize_url(url)]))


def research_cache_key(
    query: str,
    query_domains: list[str],
    allowed_prefixes: list[str],
    source_urls: list[str],
) -> str:
    domains = "|".join(sorted(d.strip().lower() for d in query_domains if d.strip()))
    prefixes = "|".join(sorted(p.strip().rstrip("/").lower() for p in allowed_prefixes if p.strip()))
    sources = "|".join(sorted(_normalize_url(u) for u in source_urls if u.strip()))
    return _key("research", _sha([query.strip().lower(), domains, prefixes, sources]))


def get_json(client: Redis, key: str) -> Any | None:
    raw = client.get(key)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def set_json(client: Redis, key: str, value: Any, ttl_seconds: int) -> None:
    client.setex(key, ttl_seconds, json.dumps(value, ensure_ascii=False))


def get_search(client: Redis, query: str, query_domains: list[str]) -> list[str] | None:
    data = get_json(client, search_cache_key(query, query_domains))
    if isinstance(data, list):
        return [str(u) for u in data]
    return None


def set_search(client: Redis, query: str, query_domains: list[str], urls: list[str]) -> None:
    set_json(client, search_cache_key(query, query_domains), urls, search_ttl())


def get_pages_bulk(client: Redis, urls: list[str]) -> dict[str, str]:
    """Return url -> markdown for cache hits (pipelined GET)."""
    if not urls:
        return {}
    pipe = client.pipeline()
    keys = [page_cache_key(u) for u in urls]
    for key in keys:
        pipe.get(key)
    values = pipe.execute()
    hits: dict[str, str] = {}
    for url, body in zip(urls, values, strict=True):
        if body and isinstance(body, str) and len(body) >= 1:
            hits[url] = body
    return hits


def set_page(client: Redis, url: str, markdown: str) -> None:
    if not markdown.strip():
        return
    client.setex(page_cache_key(url), page_ttl(), markdown)


def set_pages_bulk(client: Redis, pages: dict[str, str]) -> None:
    if not pages:
        return
    pipe = client.pipeline()
    ttl = page_ttl()
    for url, markdown in pages.items():
        if markdown.strip():
            pipe.setex(page_cache_key(url), ttl, markdown)
    pipe.execute()


def get_research(client: Redis, key: str) -> dict[str, Any] | None:
    data = get_json(client, key)
    return data if isinstance(data, dict) else None


def set_research(client: Redis, key: str, result: dict[str, Any]) -> None:
    set_json(client, key, result, research_ttl())


def kb_doc_cache_key(source_id: str) -> str:
    """Stable key for KB ingest dedup (markdown file, URL, discord export id, …)."""
    return _key("kb", _sha([source_id.strip().lower()]))


def get_kb_content_hash(client: Redis, source_id: str) -> str | None:
    value = client.get(kb_doc_cache_key(source_id))
    return value if isinstance(value, str) else None


def set_kb_content_hash(client: Redis, source_id: str, content_hash: str) -> None:
    ttl = _ttl("TRASK_CACHE_KB_TTL_SECONDS", 30 * 24 * 60 * 60)
    client.setex(kb_doc_cache_key(source_id), ttl, content_hash)


def kb_needs_reindex(client: Redis, source_id: str, content_hash: str) -> bool:
    """True when document is new or content changed (for ingest pipelines)."""
    previous = get_kb_content_hash(client, source_id)
    if previous == content_hash:
        return False
    set_kb_content_hash(client, source_id, content_hash)
    return True


def research_key_for_payload(payload: dict[str, Any]) -> str:
    query = str(payload.get("query") or "")
    query_domains = [str(x) for x in (payload.get("query_domains") or []) if str(x).strip()]
    allowed_prefixes = [str(x) for x in (payload.get("allowed_url_prefixes") or []) if str(x).strip()]
    source_urls = [str(x) for x in (payload.get("source_urls") or []) if str(x).strip()]
    return research_cache_key(query, query_domains, allowed_prefixes, source_urls)


def annotate_cache_meta(result: dict[str, Any], stats: dict[str, int]) -> dict[str, Any]:
    """Attach cache stats under research_information for operators."""
    info = dict(result.get("research_information") or {})
    info["cache"] = stats
    out = dict(result)
    out["research_information"] = info
    return out


def _self_test() -> int:
    """In-memory-free checks using a real Redis if REDIS_URL is set."""
    client = get_client()
    if not client or not ping(client):
        print("SKIP: Redis not configured or unreachable (set REDIS_URL to test)")
        return 0

    q = "__trask_cache_selftest__"
    domains = ["example.com"]
    urls = ["https://example.com/page-a", "https://example.com/page-b"]
    set_search(client, q, domains, urls)
    assert get_search(client, q, domains) == urls

    body = "# hello from self-test"
    set_page(client, urls[0], body)
    hits = get_pages_bulk(client, urls)
    assert hits.get(urls[0]) == body

    research = {"report": "ok", "research_information": {}}
    rkey = research_cache_key(q, domains, ["https://example.com"], [])
    set_research(client, rkey, research)
    assert get_research(client, rkey) == research

    client.delete(search_cache_key(q, domains), page_cache_key(urls[0]), rkey)
    print("OK: trask_cache self-test passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(_self_test())
