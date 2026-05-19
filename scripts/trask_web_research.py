#!/usr/bin/env python3
"""
Headless web research for Trask / Holocron.

stdin: JSON payload (query, allowed_url_prefixes, query_domains, source_urls, …)
stdout: JSON { report, research_information }

Discovery via DuckDuckGo; scrape via Crawl4AI (markdown); trafilatura fallback.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

MAX_CANDIDATE_URLS = 12
MAX_SCRAPE_URLS = 8
MAX_MARKDOWN_CHARS_PER_PAGE = 12_000
MIN_USABLE_BODY_CHARS = 280
SEARCH_RESULTS_PER_DOMAIN = 4

FORUM_CHROME_PATTERNS = [
    re.compile(r"\bsign up\b", re.I),
    re.compile(r"\ball activity\b", re.I),
    re.compile(r"\bmark site read\b", re.I),
    re.compile(r"\bactivity feed\b", re.I),
    re.compile(r"\bexisting user\? sign in\b", re.I),
    re.compile(r"\byour content feed\b", re.I),
]


def _normalize_prefix(value: str) -> str:
    return value.strip().rstrip("/")


def _url_allowed(url: str, prefixes: list[str]) -> bool:
    candidate = _normalize_prefix(url)
    for raw in prefixes:
        prefix = _normalize_prefix(raw)
        if not prefix:
            continue
        if candidate == prefix or candidate.startswith(prefix + "/"):
            return True
    return False


def _unique_urls(urls: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for url in urls:
        u = url.strip()
        if not u or not u.startswith(("http://", "https://")):
            continue
        key = u.rstrip("/").lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(u)
    return out


def _host_from_url(url: str) -> str:
    try:
        return urlparse(url).netloc.lower().replace("www.", "")
    except Exception:
        return ""


def _looks_like_forum_chrome(text: str) -> bool:
    if len(text) < 120:
        return True
    hits = sum(1 for pat in FORUM_CHROME_PATTERNS if pat.search(text))
    return hits >= 2


def _extract_follow_up_links(markdown: str, query: str, allowed_prefixes: list[str]) -> list[str]:
    tokens = _query_tokens(query)
    if not tokens:
        return []
    found: list[str] = []
    for _label, href in re.findall(r"\[([^\]]*)\]\((https?://[^)]+)\)", markdown):
        lower = f"{_label} {href}".lower()
        if not any(token in lower for token in tokens):
            continue
        if _url_allowed(href, allowed_prefixes):
            found.append(href)
    return _unique_urls(found)


def _truncate(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    return text[: limit - 3].rstrip() + "..."


@dataclass
class PageEvidence:
    url: str
    markdown: str


@dataclass
class GatherResult:
    pages: list[PageEvidence] = field(default_factory=list)
    visited_urls: list[str] = field(default_factory=list)
    retrieved_urls: list[str] = field(default_factory=list)
    rejected_urls: list[str] = field(default_factory=list)
    candidate_urls: list[str] = field(default_factory=list)
    cache_stats: dict[str, int] = field(default_factory=dict)


def _query_tokens(query: str) -> set[str]:
    return {t for t in re.findall(r"[a-z0-9]{3,}", query.lower()) if t not in {"what", "where", "when", "does", "the", "for", "and", "how"}}


def _rank_source_urls(query: str, source_urls: list[str]) -> list[str]:
    tokens = _query_tokens(query)
    scored: list[tuple[int, str]] = []
    for url in source_urls:
        lower = url.lower()
        score = sum(2 for token in tokens if token in lower)
        if "technical" in lower or "reference" in lower or "neocities" in lower:
            score += 1
        scored.append((score, url))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [url for _, url in scored]


def discover_urls(
    query: str,
    query_domains: list[str],
    source_urls: list[str],
    allowed_prefixes: list[str],
    cache_client: Any | None = None,
    cache_stats: dict[str, int] | None = None,
) -> list[str]:
    if cache_client is not None:
        try:
            from trask_cache import get_search, set_search

            cached = get_search(cache_client, query, query_domains)
            if cached is not None:
                if cache_stats is not None:
                    cache_stats["search_hits"] = cache_stats.get("search_hits", 0) + 1
                filtered = [u for u in cached if _url_allowed(u, allowed_prefixes)]
                return filtered[:MAX_CANDIDATE_URLS]
            if cache_stats is not None:
                cache_stats["search_misses"] = cache_stats.get("search_misses", 0) + 1
        except Exception:
            pass

    allowed_sources = [u for u in _unique_urls(source_urls) if _url_allowed(u, allowed_prefixes)]
    candidates: list[str] = _rank_source_urls(query, allowed_sources)

    domains = [d.strip() for d in query_domains if d.strip()]
    if not domains:
        domains = list({_host_from_url(p) for p in allowed_prefixes if _host_from_url(p)})

    try:
        from duckduckgo_search import DDGS

        with DDGS() as ddgs:
            for domain in domains[:6]:
                site_query = f"{query} site:{domain}"
                try:
                    for item in ddgs.text(site_query, max_results=SEARCH_RESULTS_PER_DOMAIN, backend="bing"):
                        href = (item.get("href") or item.get("url") or "").strip()
                        if href:
                            candidates.append(href)
                except Exception:
                    continue
            if len(candidates) < 3:
                try:
                    for item in ddgs.text(query, max_results=10, backend="bing"):
                        href = (item.get("href") or item.get("url") or "").strip()
                        if href:
                            candidates.append(href)
                except Exception:
                    pass
    except Exception:
        pass

    # DuckDuckGo may rate-limit; always keep ranked catalog homes as crawl seeds.
    for url in allowed_sources:
        if url not in candidates:
            candidates.append(url)

    filtered = [u for u in _unique_urls(candidates) if _url_allowed(u, allowed_prefixes)]
    result = filtered[:MAX_CANDIDATE_URLS]

    if cache_client is not None and result:
        try:
            from trask_cache import set_search

            set_search(cache_client, query, query_domains, result)
        except Exception:
            pass

    return result


def _trafilatura_fetch(url: str) -> str:
    try:
        import trafilatura

        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return ""
        text = trafilatura.extract(downloaded, include_comments=False, include_tables=True)
        return (text or "").strip()
    except Exception:
        return ""


async def _crawl_with_shared_crawler(crawler: Any, url: str) -> str:
    try:
        from crawl4ai import CrawlerRunConfig, CacheMode

        run_config = CrawlerRunConfig(cache_mode=CacheMode.BYPASS, word_count_threshold=10)
        result = await crawler.arun(url=url, config=run_config)
        if result.success and result.markdown:
            return result.markdown.strip()
    except Exception:
        pass
    return _trafilatura_fetch(url)


@contextlib.contextmanager
def _redirect_stdout_to_stderr():
    previous = sys.stdout
    sys.stdout = sys.stderr
    try:
        yield
    finally:
        sys.stdout = previous


def _page_from_cache(url: str, cached_pages: dict[str, str]) -> str | None:
    body = cached_pages.get(url)
    if not body or len(body) < MIN_USABLE_BODY_CHARS or _looks_like_forum_chrome(body):
        return None
    return _truncate(body, MAX_MARKDOWN_CHARS_PER_PAGE)


async def _resolve_page_body(
    url: str,
    crawler: Any | None,
    cache_client: Any | None,
    cached_pages: dict[str, str],
    cache_stats: dict[str, int],
) -> str:
    cached = _page_from_cache(url, cached_pages)
    if cached is not None:
        cache_stats["page_hits"] = cache_stats.get("page_hits", 0) + 1
        return cached

    cache_stats["page_misses"] = cache_stats.get("page_misses", 0) + 1
    if crawler is not None:
        body = await _crawl_with_shared_crawler(crawler, url)
    else:
        body = _trafilatura_fetch(url)

    if body and len(body) >= MIN_USABLE_BODY_CHARS and not _looks_like_forum_chrome(body):
        trimmed = _truncate(body, MAX_MARKDOWN_CHARS_PER_PAGE)
        if cache_client is not None:
            try:
                from trask_cache import set_page

                set_page(cache_client, url, trimmed)
            except Exception:
                pass
        return trimmed
    return ""


async def gather_evidence(
    query: str,
    query_domains: list[str],
    source_urls: list[str],
    allowed_prefixes: list[str],
) -> GatherResult:
    result = GatherResult()
    cache_client = None
    try:
        from trask_cache import get_client, ping

        candidate = get_client()
        if candidate is not None and ping(candidate):
            cache_client = candidate
    except Exception:
        cache_client = None

    stats = result.cache_stats
    result.candidate_urls = discover_urls(
        query,
        query_domains,
        source_urls,
        allowed_prefixes,
        cache_client=cache_client,
        cache_stats=stats,
    )
    scrape_targets = list(result.candidate_urls[:MAX_SCRAPE_URLS])
    seen_targets = set(scrape_targets)

    cached_pages: dict[str, str] = {}
    if cache_client is not None and scrape_targets:
        try:
            from trask_cache import get_pages_bulk

            cached_pages = get_pages_bulk(cache_client, scrape_targets)
        except Exception:
            cached_pages = {}

    async def accept_url(url: str, crawler: Any | None) -> str | None:
        result.visited_urls.append(url)
        body = await _resolve_page_body(url, crawler, cache_client, cached_pages, stats)
        if not body:
            result.rejected_urls.append(url)
            return None
        result.pages.append(PageEvidence(url=url, markdown=body))
        result.retrieved_urls.append(url)
        return body

    try:
        from crawl4ai import AsyncWebCrawler, BrowserConfig

        browser_config = BrowserConfig(headless=True, verbose=False)
        with _redirect_stdout_to_stderr():
            async with AsyncWebCrawler(config=browser_config) as crawler:
                for url in list(scrape_targets):
                    body = await accept_url(url, crawler)
                    if not body:
                        continue
                    for follow_up in _extract_follow_up_links(body, query, allowed_prefixes):
                        if follow_up in seen_targets or len(scrape_targets) >= MAX_SCRAPE_URLS:
                            continue
                        seen_targets.add(follow_up)
                        scrape_targets.append(follow_up)
                        if cache_client is not None:
                            try:
                                from trask_cache import get_pages_bulk

                                cached_pages.update(get_pages_bulk(cache_client, [follow_up]))
                            except Exception:
                                pass
                        await accept_url(follow_up, crawler)
    except Exception:
        for url in scrape_targets:
            if url in result.retrieved_urls:
                continue
            await accept_url(url, None)

    return result


def build_report(query: str, gather: GatherResult) -> str:
    if not gather.pages:
        return "I could not complete live archive synthesis for this question right now."

    sections: list[str] = [
        f"# Research evidence for: {query.strip()}",
        "",
        "The following excerpts were retrieved from approved archive sources.",
        "",
    ]
    for page in gather.pages:
        sections.append(f"## Evidence from {page.url}")
        sections.append("")
        sections.append(page.markdown)
        sections.append("")
    return "\n".join(sections).strip()


def run_payload(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or "").strip()
    if not query:
        raise ValueError("query is required")

    query_domains = [str(x) for x in (payload.get("query_domains") or []) if str(x).strip()]
    allowed_prefixes = [str(x) for x in (payload.get("allowed_url_prefixes") or []) if str(x).strip()]
    source_urls = [str(x) for x in (payload.get("source_urls") or []) if str(x).strip()]

    env_prefixes = os.environ.get("TRASK_ALLOWED_URL_PREFIXES", "")
    if env_prefixes and not allowed_prefixes:
        allowed_prefixes = [line.strip() for line in env_prefixes.splitlines() if line.strip()]
    env_domains = os.environ.get("TRASK_ALLOWED_QUERY_DOMAINS", "")
    if env_domains and not query_domains:
        query_domains = [line.strip() for line in env_domains.splitlines() if line.strip()]

    try:
        from trask_cache import (
            annotate_cache_meta,
            get_client,
            get_research,
            ping,
            research_key_for_payload,
            set_research,
        )

        cache_client = get_client()
        if cache_client is not None and ping(cache_client):
            rkey = research_key_for_payload(
                {
                    "query": query,
                    "query_domains": query_domains,
                    "allowed_url_prefixes": allowed_prefixes,
                    "source_urls": source_urls,
                },
            )
            cached_result = get_research(cache_client, rkey)
            if cached_result is not None:
                stats = dict((cached_result.get("research_information") or {}).get("cache") or {})
                stats["research_hits"] = stats.get("research_hits", 0) + 1
                return annotate_cache_meta(cached_result, stats)
    except Exception:
        pass

    gather = asyncio.run(
        gather_evidence(query, query_domains, source_urls, allowed_prefixes),
    )
    report = build_report(query, gather)

    result = {
        "report": report,
        "research_information": {
            "source_urls": gather.retrieved_urls,
            "cited_urls": gather.retrieved_urls,
            "retrieved_urls": gather.retrieved_urls,
            "visited_urls": gather.visited_urls,
            "query_domains": query_domains,
            "allowed_url_prefixes": allowed_prefixes,
            "rejected_source_urls": gather.rejected_urls,
        },
    }

    try:
        from trask_cache import annotate_cache_meta, get_client, ping, research_key_for_payload, set_research

        cache_client = get_client()
        if cache_client is not None and ping(cache_client) and gather.pages:
            rkey = research_key_for_payload(
                {
                    "query": query,
                    "query_domains": query_domains,
                    "allowed_url_prefixes": allowed_prefixes,
                    "source_urls": source_urls,
                },
            )
            stats = dict(gather.cache_stats)
            stats["research_misses"] = stats.get("research_misses", 0) + 1
            to_store = annotate_cache_meta(result, stats)
            set_research(cache_client, rkey, to_store)
            return to_store
    except Exception:
        pass

    if gather.cache_stats:
        try:
            from trask_cache import annotate_cache_meta

            return annotate_cache_meta(result, gather.cache_stats)
        except Exception:
            pass

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Trask headless web research (Crawl4AI + DDG)")
    parser.add_argument("--dry-run", action="store_true", help="Import dependencies and exit 0")
    args = parser.parse_args()

    if args.dry_run:
        import crawl4ai  # noqa: F401
        import duckduckgo_search  # noqa: F401
        import trafilatura  # noqa: F401

        print(json.dumps({"ok": True, "backend": "crawl4ai"}))
        return 0

    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"error": "empty stdin"}), file=sys.stderr)
        return 1

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(json.dumps({"error": f"invalid json: {exc}"}), file=sys.stderr)
        return 1

    try:
        result = run_payload(payload)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1

    sys.stdout.write(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
