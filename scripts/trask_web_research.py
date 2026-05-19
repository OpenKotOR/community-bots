#!/usr/bin/env python3
"""
Trask live web research (stdin JSON → stdout JSON).

Replaces the removed vendored headless runner. Retrieval order:
  1. POST {TRASK_INDEXER_BASE_URL}/retrieve (Chroma passages)
  2. Local Chroma query via trask_indexer (same repo, no HTTP)
  3. DuckDuckGo + httpx fetch for allowlisted URLs (when ddgs is installed)

Stdout is a single JSON object:
  { "report": "<markdown>", "research_information": { "visited_urls": [...], ... } }
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEXER_URL = "http://127.0.0.1:8790"
MAX_PASSAGES = 12
MAX_DDG_RESULTS = 6
FETCH_TIMEOUT_S = 20


def _die(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def _payload_string_list(payload: dict[str, Any], field: str) -> list[str]:
    raw = payload.get(field) or []
    if not isinstance(raw, list) or not all(isinstance(value, str) for value in raw):
        _die(f'payload: "{field}" must be a list of strings when set', 1)
    return [value.strip().rstrip("/") for value in raw if value.strip()]


def _hostname_matches(hostname: str, allowed_domain: str) -> bool:
    host = hostname.lower().removeprefix("www.")
    domain = allowed_domain.lower().removeprefix("www.")
    return host == domain or host.endswith(f".{domain}")


def _url_allowed(url: str, domains: list[str], prefixes: list[str]) -> bool:
    if not domains and not prefixes:
        return True
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False
    normalized = url.strip().rstrip("/")
    if prefixes:
        return any(normalized == prefix or normalized.startswith(f"{prefix}/") for prefix in prefixes)
    return bool(domains and any(_hostname_matches(parsed.hostname or "", domain) for domain in domains))


def _indexer_base_url() -> str:
    return (os.environ.get("TRASK_INDEXER_BASE_URL") or DEFAULT_INDEXER_URL).strip().rstrip("/")


def _retrieve_via_http(query: str, limit: int) -> list[dict[str, Any]]:
    body = json.dumps({"query": query, "limit": limit}).encode("utf-8")
    req = Request(
        f"{_indexer_base_url()}/retrieve",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=FETCH_TIMEOUT_S) as resp:
            parsed = json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError):
        return []
    passages = parsed.get("passages")
    if not isinstance(passages, list):
        return []
    out: list[dict[str, Any]] = []
    for item in passages:
        if not isinstance(item, dict):
            continue
        quote = str(item.get("quote") or "").strip()
        url = str(item.get("url") or "").strip()
        if quote and url:
            out.append(item)
    return out


def _retrieve_via_local_chroma(query: str, limit: int) -> list[dict[str, Any]]:
    indexer_src = REPO_ROOT / "infra" / "trask-indexer"
    if not indexer_src.is_dir():
        return []
    sys.path.insert(0, str(indexer_src))
    try:
        from trask_indexer.chroma_store import (  # type: ignore[import-not-found]
            DEFAULT_COLLECTION,
            get_chroma_client,
            get_or_create_collection,
            query_passages,
        )
    except Exception:
        return []

    data_dir = Path(os.environ.get("TRASK_INDEXER_DATA_DIR", REPO_ROOT / "data/trask-indexer"))
    persist_dir = data_dir / "chroma"
    if not persist_dir.is_dir():
        return []

    try:
        client = get_chroma_client(persist_dir)
        collection = get_or_create_collection(client, DEFAULT_COLLECTION)
        hits = query_passages(collection, query, limit=limit)
    except Exception:
        return []

    return [
        {
            "id": h.id,
            "url": h.url,
            "host": h.host,
            "quote": h.quote,
            "score": h.score,
            "sourceId": h.source_id,
        }
        for h in hits
    ]


def _ddg_snippets(query: str, domains: list[str], prefixes: list[str], limit: int) -> list[dict[str, Any]]:
    try:
        from ddgs import DDGS  # type: ignore[import-not-found]
    except ImportError:
        return []

    scoped = query
    if domains:
        scoped = f"{query} ({' OR '.join(f'site:{d}' for d in domains[:4])})"

    passages: list[dict[str, Any]] = []
    try:
        results = DDGS().text(scoped, region="wt-wt", max_results=max(limit * 2, 8))
    except Exception:
        return []

    for idx, row in enumerate(results or []):
        if not isinstance(row, dict):
            continue
        url = str(row.get("href") or row.get("url") or "").strip()
        body = str(row.get("body") or row.get("snippet") or "").strip()
        if not url or not body or not _url_allowed(url, domains, prefixes):
            continue
        host = urlparse(url).hostname or ""
        passages.append(
            {
                "id": f"ddg-{idx}",
                "url": url,
                "host": host,
                "quote": body[:1200],
                "score": 0.0,
                "sourceId": "duckduckgo",
            }
        )
        if len(passages) >= limit:
            break
    return passages


def _build_report(query: str, passages: list[dict[str, Any]]) -> str:
    if not passages:
        return (
            f"# Research digest\n\n"
            f"No indexed or web passages were retrieved for: **{query.strip()}**.\n\n"
            f"Start the Trask indexer (`trask-indexer serve` on port 8790) or install `ddgs` in the research venv."
        )

    lines = [f"# Research digest", "", f"**Query:** {query.strip()}", ""]
    for idx, passage in enumerate(passages, start=1):
        url = str(passage.get("url") or "").strip()
        quote = str(passage.get("quote") or "").strip()
        host = str(passage.get("host") or urlparse(url).hostname or "source").strip()
        lines.append(f"## Source {idx} — {host}")
        if url:
            lines.append(f"- URL: {url}")
        lines.append("")
        lines.append(quote)
        lines.append("")
    return "\n".join(lines).strip()


def _unique_urls(passages: list[dict[str, Any]]) -> list[str]:
    seen: set[str] = set()
    urls: list[str] = []
    for passage in passages:
        url = str(passage.get("url") or "").strip().rstrip("/")
        if not url or url in seen:
            continue
        seen.add(url)
        urls.append(url)
    return urls


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        _die(f"stdin must be one JSON object: {exc}", 1)

    if not isinstance(payload, dict):
        _die("stdin JSON must be an object", 1)

    query = str(payload.get("query") or "").strip()
    if not query:
        _die('payload: "query" is required', 1)

    domains = _payload_string_list(payload, "query_domains")
    prefixes = _payload_string_list(payload, "allowed_url_prefixes")
    limit = min(MAX_PASSAGES, max(4, int(os.environ.get("TRASK_WEB_RESEARCH_MAX_PASSAGES", "10"))))

    passages = _retrieve_via_http(query, limit)
    if not passages:
        passages = _retrieve_via_local_chroma(query, limit)

    vector_miss = len(passages) == 0
    ddg_fallback = os.environ.get("TRASK_WEB_RESEARCH_DDG_FALLBACK", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if vector_miss and ddg_fallback:
        passages = _ddg_snippets(query, domains, prefixes, limit)

    if domains or prefixes:
        filtered: list[dict[str, Any]] = []
        for passage in passages:
            url = str(passage.get("url") or "")
            if url.startswith("discord://"):
                filtered.append(passage)
                continue
            if _url_allowed(url, domains, prefixes):
                filtered.append(passage)
        passages = filtered

    index_miss = vector_miss and len(passages) == 0

    urls = _unique_urls(passages)
    report = _build_report(query, passages)
    if not report.strip():
        _die("empty report after retrieval", 1)

    out = {
        "report": report,
        "passages": [
            {
                "quote": str(p.get("quote") or "").strip(),
                "url": str(p.get("url") or "").strip(),
                "host": str(p.get("host") or "").strip(),
                "score": float(p.get("score") or 0.0),
                "sourceId": str(p.get("sourceId") or p.get("source_id") or "").strip(),
            }
            for p in passages
            if str(p.get("quote") or "").strip() and str(p.get("url") or "").strip()
        ],
        "research_information": {
            "source_urls": urls,
            "cited_urls": urls,
            "retrieved_urls": urls,
            "visited_urls": urls,
            "query_domains": domains,
            "allowed_url_prefixes": prefixes,
            "rejected_source_urls": [],
            "index_miss": index_miss,
        },
    }
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
