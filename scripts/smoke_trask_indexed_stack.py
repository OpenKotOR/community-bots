#!/usr/bin/env python3
"""
U0 spike: crawl one approved URL → chunk → FastEmbed → Chroma → print retrieve hits.

Usage (after bootstrap_trask_indexer.sh + export allowlist):
  python scripts/smoke_trask_indexed_stack.py
  python scripts/smoke_trask_indexed_stack.py --fixture   # offline, no Crawl4AI
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT / "infra" / "trask-indexer") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "infra" / "trask-indexer"))

from trask_indexer.allowlist import default_allowlist_path, load_allowlist
from trask_indexer.chunk import chunk_markdown
from trask_indexer.chroma_store import (
    get_chroma_client,
    get_or_create_collection,
    query_passages,
    upsert_chunks,
)
from trask_indexer.crawl import crawl_url

DEFAULT_URL = "https://deadlystream.com/files/file/1982-tslpatcher/"


def _load_golden_fixtures() -> list[dict[str, str]]:
    golden_path = REPO_ROOT / "data" / "trask" / "eval" / "golden-queries.json"
    with golden_path.open(encoding="utf-8") as handle:
        payload = json.load(handle)
    fixtures: list[dict[str, str]] = []
    for entry in payload.get("queries", []):
        fixture = entry.get("fixture")
        if not fixture:
            continue
        fixtures.append(
            {
                "query": entry["question"],
                "url": fixture["url"],
                "host": fixture["host"],
                "source_id": fixture["sourceId"],
                "markdown": fixture["markdown"],
                "must_contain": fixture["mustContain"],
            }
        )
        companion = entry.get("companionFixture")
        if companion:
            fixtures.append(
                {
                    "query": entry["question"],
                    "url": companion["url"],
                    "host": companion["host"],
                    "source_id": companion["sourceId"],
                    "markdown": companion["markdown"],
                    "must_contain": companion["mustContain"],
                }
            )
    return fixtures


GOLDEN_FIXTURES: list[dict[str, str]] = _load_golden_fixtures()
DEFAULT_QUERY = GOLDEN_FIXTURES[0]["query"] if GOLDEN_FIXTURES else ""


def pick_seed_url(catalog) -> str:
    for source in catalog.sources:
        if "neocities" in source.home_url or "deadlystream" in source.home_url:
            return source.home_url.rstrip("/") + (
                "/modding/tslpatcher/" if "neocities" in source.home_url else "/"
            )
    return catalog.sources[0].home_url if catalog.sources else DEFAULT_URL


def seed_golden_fixtures(data_dir: Path, *, verify: bool) -> int:
    persist_dir = data_dir / "chroma"
    if persist_dir.is_dir():
        import shutil

        shutil.rmtree(persist_dir)
        print(f"Cleared existing Chroma data at {persist_dir}.")
    client = get_chroma_client(persist_dir)
    collection = get_or_create_collection(client)
    total = 0
    for fixture in GOLDEN_FIXTURES:
        url = fixture["url"]
        host = fixture["host"]
        source_id = fixture["source_id"]
        chunks = chunk_markdown(fixture["markdown"], url=url)
        if not chunks:
            print(f"No chunks for fixture {url}", file=sys.stderr)
            return 1
        total += upsert_chunks(collection, url=url, host=host, source_id=source_id, chunks=chunks)
    print(f"Upserted {total} golden fixture vectors into {persist_dir}.")

    if not verify:
        return 0

    for fixture in GOLDEN_FIXTURES:
        hits = query_passages(collection, fixture["query"], limit=3)
        joined = " ".join(h.quote.lower() for h in hits)
        needle = fixture["must_contain"].lower()
        if needle not in joined:
            print(
                f"Retrieve verify failed for: {fixture['query']!r} (expected {needle!r} in hits)",
                file=sys.stderr,
            )
            return 1
        print(f"OK retrieve: {fixture['query'][:48]}…")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Trask indexed stack smoke test")
    parser.add_argument("--url", help="Approved URL to crawl")
    parser.add_argument("--query", default=DEFAULT_QUERY)
    parser.add_argument(
        "--fixture",
        action="store_true",
        help="Skip Crawl4AI; index synthetic TSLPatcher markdown",
    )
    parser.add_argument(
        "--golden-fixtures",
        action="store_true",
        help="Index all five Holocron golden-query fixture passages",
    )
    parser.add_argument(
        "--verify-retrieve",
        action="store_true",
        help="With --golden-fixtures, assert each golden query retrieves relevant text",
    )
    parser.add_argument(
        "--data-dir",
        default=os.environ.get("TRASK_INDEXER_DATA_DIR", "data/trask-indexer"),
    )
    args = parser.parse_args()

    data_dir = Path(args.data_dir)

    if args.golden_fixtures:
        return seed_golden_fixtures(data_dir, verify=args.verify_retrieve)

    allowlist_path = default_allowlist_path(data_dir)
    if not allowlist_path.is_file():
        print(f"Missing {allowlist_path}; run: node scripts/export_trask_allowlist_catalog.mjs", file=sys.stderr)
        return 1

    catalog = load_allowlist(allowlist_path)
    url = args.url or pick_seed_url(catalog)
    if not catalog.is_approved_url(url):
        print(f"URL not on allowlist: {url}", file=sys.stderr)
        return 1

    host = urlparse(url).hostname or "unknown"
    source_id = next((s.id for s in catalog.sources if url.startswith(s.home_url)), host)

    if args.fixture:
        markdown = (
            "# TSLPatcher\n\n"
            "TSLPatcher is a mod installation tool for Knights of the Old Republic and TSL. "
            "It applies changes via list files, 2DA patches, and GFF edits without manual file copying."
        )
        print("Using fixture markdown (no crawl).")
    else:
        print(f"Crawling {url} ...")
        page = crawl_url(url)
        if not page.success or not page.markdown:
            print(f"Crawl failed: {page.error}", file=sys.stderr)
            return 1
        markdown = page.markdown
        print(f"Crawled {len(markdown)} chars of markdown.")

    chunks = chunk_markdown(markdown, url=url)
    if not chunks:
        print("No chunks produced.", file=sys.stderr)
        return 1
    print(f"Chunked into {len(chunks)} passages.")

    persist_dir = data_dir / "chroma"
    client = get_chroma_client(persist_dir)
    collection = get_or_create_collection(client)
    n = upsert_chunks(collection, url=url, host=host, source_id=source_id, chunks=chunks)
    print(f"Upserted {n} vectors into Chroma at {persist_dir}.")

    hits = query_passages(collection, args.query, limit=5)
    if len(hits) < 1:
        print("Retrieve returned no hits.", file=sys.stderr)
        return 1

    print(f"\nQuery: {args.query}\n")
    for i, hit in enumerate(hits, start=1):
        preview = hit.quote.replace("\n", " ")[:200]
        print(f"[{i}] score={hit.score:.3f} {hit.url}")
        print(f"    {preview}...")

    joined = " ".join(h.quote.lower() for h in hits)
    if "tslpatcher" not in joined and "patch" not in joined:
        print("Warning: top hits may not mention TSLPatcher (index may need a better seed URL).", file=sys.stderr)

    print("\nSmoke OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
