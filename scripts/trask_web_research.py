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

import argparse
import json
import logging
import os
import re
import sys
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INDEXER_URL = "http://127.0.0.1:8790"
LOG = logging.getLogger("trask.research")


def _load_retrieval_defaults() -> dict[str, Any]:
    path = os.environ.get("TRASK_RETRIEVAL_DEFAULTS_PATH") or str(
        REPO_ROOT / "data" / "trask" / "retrieval.defaults.json"
    )
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except OSError:
        return {}


_RETRIEVAL_DEFAULTS = _load_retrieval_defaults()
MAX_PASSAGES = int(_RETRIEVAL_DEFAULTS.get("maxPassages", 12))
MAX_DDG_RESULTS = int(_RETRIEVAL_DEFAULTS.get("maxDdgResults", 6))
FETCH_TIMEOUT_S = max(1, int(_RETRIEVAL_DEFAULTS.get("fetchTimeoutMs", 20_000) / 1000))
URL_VERIFY_TIMEOUT_S = max(
    1,
    int(_RETRIEVAL_DEFAULTS.get("urlVerifyTimeoutMs", _RETRIEVAL_DEFAULTS.get("fetchTimeoutMs", 8000)) / 1000),
)


def configure_logging(*, verbose: bool = False) -> None:
    level_name = os.environ.get("TRASK_RESEARCH_LOG_LEVEL", "INFO").strip().upper()
    if verbose:
        level_name = "DEBUG"
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(
        level=level,
        stream=sys.stderr,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    LOG.debug("logging configured level=%s verbose=%s", level_name, verbose)


def _die(message: str, code: int = 1) -> None:
    LOG.error(message)
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
    if prefixes and any(normalized == prefix or normalized.startswith(f"{prefix}/") for prefix in prefixes):
        return True
    if domains and any(_hostname_matches(parsed.hostname or "", domain) for domain in domains):
        return True
    return not prefixes and not domains


def _is_discord_jump_url(url: str) -> bool:
    return bool(re.match(r"^https://discord\.com/channels/\d+/\d+/\d+", url.strip(), re.I))


def _verify_https_url(url: str) -> bool:
    if _is_discord_jump_url(url):
        LOG.debug("url_verify skip discord jump %s", url)
        return True
    if url.startswith("discord://"):
        return True
    for method in ("HEAD", "GET"):
        try:
            req = Request(url, method=method)
            with urlopen(req, timeout=URL_VERIFY_TIMEOUT_S) as resp:
                status = getattr(resp, "status", 200) or 200
                ok = 200 <= int(status) < 400
                LOG.info("url_verify %s method=%s status=%s ok=%s", url, method, status, ok)
                return ok
        except (HTTPError, URLError, TimeoutError, ValueError) as exc:
            LOG.warning("url_verify fail %s method=%s error=%s", url, method, exc)
    return False


def _normalize_passage(item: dict[str, Any]) -> dict[str, Any] | None:
    quote = str(item.get("quote") or "").strip()
    url = str(item.get("url") or "").strip()
    if not quote or not url:
        return None
    return {
        "quote": quote,
        "url": url,
        "host": str(item.get("host") or urlparse(url).hostname or "source").strip(),
        "score": float(item.get("score") or 0.0),
        "sourceId": str(item.get("sourceId") or item.get("source_id") or "").strip(),
        "guildId": str(item.get("guildId") or item.get("guild_id") or "").strip(),
        "channelId": str(item.get("channelId") or item.get("channel_id") or "").strip(),
        "firstMessageId": str(item.get("firstMessageId") or item.get("first_message_id") or "").strip(),
    }


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
    started = time.monotonic()
    try:
        with urlopen(req, timeout=FETCH_TIMEOUT_S) as resp:
            parsed = json.loads(resp.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        LOG.warning("retrieve_http failed error=%s", exc)
        return []
    elapsed_ms = int((time.monotonic() - started) * 1000)
    passages = parsed.get("passages")
    if not isinstance(passages, list):
        return []
    out: list[dict[str, Any]] = []
    for item in passages:
        if not isinstance(item, dict):
            continue
        normalized = _normalize_passage(item)
        if normalized:
            out.append(normalized)
    LOG.info("retrieve_http passages=%s elapsed_ms=%s", len(out), elapsed_ms)
    for idx, passage in enumerate(out):
        LOG.debug(
            "passage[%s] url=%s host=%s quote_len=%s guild=%s channel=%s msg=%s",
            idx,
            passage.get("url"),
            passage.get("host"),
            len(str(passage.get("quote") or "")),
            passage.get("guildId"),
            passage.get("channelId"),
            passage.get("firstMessageId"),
        )
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
    except Exception as exc:
        LOG.warning("retrieve_chroma import failed error=%s", exc)
        return []

    data_dir = Path(os.environ.get("TRASK_INDEXER_DATA_DIR", REPO_ROOT / "data/trask-indexer"))
    persist_dir = data_dir / "chroma"
    if not persist_dir.is_dir():
        LOG.info("retrieve_chroma skipped missing persist_dir=%s", persist_dir)
        return []

    started = time.monotonic()
    try:
        client = get_chroma_client(persist_dir)
        collection = get_or_create_collection(client, DEFAULT_COLLECTION)
        hits = query_passages(collection, query, limit=limit)
    except Exception as exc:
        LOG.warning("retrieve_chroma query failed error=%s", exc)
        return []

    out = [
        {
            "id": h.id,
            "url": h.url,
            "host": h.host,
            "quote": h.quote,
            "score": h.score,
            "sourceId": h.source_id,
            "guildId": h.guild_id,
            "channelId": h.channel_id,
            "firstMessageId": h.first_message_id,
        }
        for h in hits
    ]
    LOG.info(
        "retrieve_chroma passages=%s elapsed_ms=%s",
        len(out),
        int((time.monotonic() - started) * 1000),
    )
    return out


def _ddg_snippets(query: str, domains: list[str], prefixes: list[str], limit: int) -> list[dict[str, Any]]:
    try:
        from ddgs import DDGS  # type: ignore[import-not-found]
    except ImportError:
        LOG.info("ddg_fallback skipped ddgs not installed")
        return []

    scoped = query
    if domains:
        scoped = f"{query} ({' OR '.join(f'site:{d}' for d in domains[:4])})"

    passages: list[dict[str, Any]] = []
    try:
        results = DDGS().text(scoped, region="wt-wt", max_results=max(limit * 2, 8))
    except Exception as exc:
        LOG.warning("ddg_fallback search failed error=%s", exc)
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
                "guildId": "",
                "channelId": "",
                "firstMessageId": "",
            }
        )
        if len(passages) >= limit:
            break
    LOG.info("ddg_fallback passages=%s", len(passages))
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


def _passage_from_ddg(passage: dict[str, Any]) -> bool:
    source_id = str(passage.get("sourceId") or passage.get("source_id") or "").strip().lower()
    passage_id = str(passage.get("id") or "").strip().lower()
    return source_id == "duckduckgo" or passage_id.startswith("ddg-")


def _trust_indexer_urls_without_probe() -> bool:
    return os.environ.get("TRASK_TRUST_INDEXER_CITATION_URLS", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


def _verify_passages(passages: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """Drop any https citation that returns 404 or other non-2xx/3xx (HEAD then GET)."""
    verified: list[dict[str, Any]] = []
    rejected: list[str] = []
    trust_indexer = _trust_indexer_urls_without_probe()
    for passage in passages:
        url = str(passage.get("url") or "").strip()
        if url.startswith("discord://"):
            passage["verified"] = True
            verified.append(passage)
            continue
        if not url.startswith("http"):
            rejected.append(url)
            continue
        if trust_indexer and not _passage_from_ddg(passage):
            passage["verified"] = True
            verified.append(passage)
            continue
        if _verify_https_url(url):
            passage["verified"] = True
            verified.append(passage)
        else:
            rejected.append(url)
    LOG.info("url_verify summary kept=%s rejected=%s", len(verified), len(rejected))
    return verified, rejected


def run_research(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or "").strip()
    if not query:
        _die('payload: "query" is required', 1)

    domains = _payload_string_list(payload, "query_domains")
    prefixes = _payload_string_list(payload, "allowed_url_prefixes")
    default_limit = int(_RETRIEVAL_DEFAULTS.get("retrieveLimit", MAX_PASSAGES))
    limit = min(MAX_PASSAGES, max(4, int(os.environ.get("TRASK_WEB_RESEARCH_MAX_PASSAGES", str(default_limit)))))

    LOG.info(
        "research_start query=%r domains=%s prefixes=%s limit=%s indexer=%s",
        query[:120],
        len(domains),
        len(prefixes),
        limit,
        _indexer_base_url(),
    )

    passages = _retrieve_via_http(query, limit)
    allow_local_chroma = os.environ.get("TRASK_WEB_RESEARCH_LOCAL_CHROMA", "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )
    if not passages and allow_local_chroma:
        LOG.info("retrieve_http empty; trying local chroma (TRASK_WEB_RESEARCH_LOCAL_CHROMA=1)")
        passages = _retrieve_via_local_chroma(query, limit)
    elif not passages:
        LOG.warning(
            "retrieve_http returned no passages; local chroma disabled (set TRASK_WEB_RESEARCH_LOCAL_CHROMA=1 to bypass Worker)"
        )

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
        LOG.info("allowlist_filter before=%s after=%s", len(passages), len(filtered))
        passages = filtered

    passages, rejected_urls = _verify_passages(passages)
    index_miss = vector_miss and len(passages) == 0

    urls = _unique_urls(passages)
    report = _build_report(query, passages)
    if not report.strip():
        _die("empty report after retrieval", 1)

    LOG.info(
        "research_done passages=%s urls=%s index_miss=%s rejected=%s",
        len(passages),
        len(urls),
        index_miss,
        len(rejected_urls),
    )

    return {
        "report": report,
        "passages": [
            {
                "quote": str(p.get("quote") or "").strip(),
                "url": str(p.get("url") or "").strip(),
                "host": str(p.get("host") or "").strip(),
                "score": float(p.get("score") or 0.0),
                "sourceId": str(p.get("sourceId") or p.get("source_id") or "").strip(),
                "guildId": str(p.get("guildId") or "").strip(),
                "channelId": str(p.get("channelId") or "").strip(),
                "firstMessageId": str(p.get("firstMessageId") or "").strip(),
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
            "rejected_source_urls": rejected_urls,
            "index_miss": index_miss,
            "indexer_url": _indexer_base_url(),
            "retrieve_limit": limit,
            "passages_count": len(passages),
            "local_chroma_enabled": allow_local_chroma,
            "ddg_fallback_enabled": ddg_fallback,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Trask live web research (stdin JSON → stdout JSON)")
    parser.add_argument("-v", "--verbose", action="store_true", help="Enable DEBUG logging on stderr")
    args = parser.parse_args()
    configure_logging(verbose=args.verbose)

    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError as exc:
        _die(f"stdin must be one JSON object: {exc}", 1)

    if not isinstance(payload, dict):
        _die("stdin JSON must be an object", 1)

    out = run_research(payload)
    sys.stdout.write(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
