from __future__ import annotations

import argparse
import os
from pathlib import Path
from urllib.parse import urlparse

import uvicorn

from trask_indexer.allowlist import default_allowlist_path, load_allowlist
from trask_indexer.chunk import chunk_markdown
from trask_indexer.chroma_store import (
    DEFAULT_COLLECTION,
    get_chroma_client,
    get_or_create_collection,
    query_passages,
    upsert_chunks,
)
from trask_indexer.crawl import crawl_url
from trask_indexer.retrieve_api import create_app


def _data_dir() -> Path:
    return Path(os.environ.get("TRASK_INDEXER_DATA_DIR", "data/trask-indexer"))


def cmd_list_seeds(_: argparse.Namespace) -> int:
    catalog = load_allowlist(default_allowlist_path(_data_dir()))
    for source in catalog.sources:
        print(f"{source.id}\t{source.home_url}")
    print(f"# {len(catalog.sources)} sources", flush=True)
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    app = create_app()
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="trask-indexer")
    sub = parser.add_subparsers(dest="command", required=True)

    list_parser = sub.add_parser("list-seeds", help="Print approved catalog seeds")
    list_parser.set_defaults(func=cmd_list_seeds)

    serve_parser = sub.add_parser("serve", help="Run POST /retrieve API")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8790)
    serve_parser.set_defaults(func=cmd_serve)

    args = parser.parse_args()
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()
