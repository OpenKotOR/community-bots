from __future__ import annotations

import argparse
import os
from pathlib import Path
from urllib.parse import urlparse

import uvicorn

from trask_indexer.allowlist import default_allowlist_path, load_allowlist
from trask_indexer.batch_crawl import run_batch_crawl
from trask_indexer.retrieve_api import create_app
from trask_indexer.worker import drain_reindex_queue, parse_queue_poll_ms, run_queue_worker


def _data_dir() -> Path:
    return Path(os.environ.get("TRASK_INDEXER_DATA_DIR", "data/trask-indexer"))


def cmd_list_seeds(_: argparse.Namespace) -> int:
    catalog = load_allowlist(default_allowlist_path(_data_dir()))
    for source in catalog.sources:
        print(f"{source.id}\t{source.home_url}")
    print(f"# {len(catalog.sources)} sources", flush=True)
    return 0


def cmd_crawl_seeds(args: argparse.Namespace) -> int:
    source_ids = set(args.source_id) if args.source_id else None
    try:
        result = run_batch_crawl(
            source_ids=source_ids,
            limit=args.limit,
            dry_run=args.dry_run,
            data_dir=_data_dir(),
        )
    except FileNotFoundError as exc:
        print(f"error: {exc}", flush=True)
        return 1
    print(
        f"# crawl-seeds attempted={result.attempted} indexed={result.indexed} "
        f"failed={result.failed} dry_run={result.dry_run}",
        flush=True,
    )
    return 0 if result.dry_run or result.failed == 0 else 1


def cmd_drain_queue(args: argparse.Namespace) -> int:
    try:
        result = drain_reindex_queue(dry_run=args.dry_run, data_dir=_data_dir())
    except TimeoutError as exc:
        print(f"error: {exc}", flush=True)
        return 1
    except FileNotFoundError as exc:
        print(f"error: {exc}", flush=True)
        return 1

    queued = result.dequeued_source_ids
    if not queued:
        print("# drain-queue: queue empty", flush=True)
        return 0

    print(f"# drain-queue dequeued={len(queued)} ids={','.join(queued)}", flush=True)
    if result.crawl is None:
        return 0

    crawl = result.crawl
    print(
        f"# drain-queue attempted={crawl.attempted} indexed={crawl.indexed} "
        f"failed={crawl.failed} dry_run={crawl.dry_run}",
        flush=True,
    )
    if args.dry_run:
        return 0
    return 0 if crawl.failed == 0 else 1


def cmd_run_queue_worker(args: argparse.Namespace) -> int:
    poll_ms = parse_queue_poll_ms(args.poll_ms)
    try:
        run_queue_worker(poll_ms=poll_ms, data_dir=_data_dir())
    except KeyboardInterrupt:
        print("# run-queue-worker: stopped", flush=True)
        return 0
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

    crawl_parser = sub.add_parser(
        "crawl-seeds",
        help="Batch Crawl4AI fetch of allowlist home URLs into Chroma",
    )
    crawl_parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max number of catalog sources to crawl (default: all)",
    )
    crawl_parser.add_argument(
        "--source-id",
        action="append",
        default=[],
        help="Crawl only this catalog source id (repeatable)",
    )
    crawl_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List seed URLs without crawling",
    )
    crawl_parser.set_defaults(func=cmd_crawl_seeds)

    drain_parser = sub.add_parser(
        "drain-queue",
        help="Drain INGEST_STATE_DIR reindex queue into Chroma via Crawl4AI",
    )
    drain_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List queued source ids and seed targets without crawling",
    )
    drain_parser.set_defaults(func=cmd_drain_queue)

    worker_parser = sub.add_parser(
        "run-queue-worker",
        help="Continuously drain INGEST_STATE_DIR reindex queue into Chroma",
    )
    worker_parser.add_argument(
        "poll_ms",
        nargs="?",
        default=None,
        help="Poll interval in ms (default 15000, clamp 1000-300000)",
    )
    worker_parser.set_defaults(func=cmd_run_queue_worker)

    serve_parser = sub.add_parser("serve", help="Run POST /retrieve API")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=8790)
    serve_parser.set_defaults(func=cmd_serve)

    args = parser.parse_args()
    raise SystemExit(args.func(args))


if __name__ == "__main__":
    main()
