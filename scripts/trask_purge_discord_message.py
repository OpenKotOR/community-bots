#!/usr/bin/env python3
"""Purge indexed Trask Discord evidence by guild/channel/message id."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
INDEXER_SRC = REPO_ROOT / "infra" / "trask-indexer"


def main() -> int:
    parser = argparse.ArgumentParser(description="Purge Discord message evidence from the Trask index.")
    parser.add_argument("--guild-id", default="", help="Optional guild id guard.")
    parser.add_argument("--channel-id", required=True, help="Discord channel id.")
    parser.add_argument("--message-id", required=True, help="Discord message id to purge.")
    parser.add_argument("--dry-run", action="store_true", help="Report matching rows without deleting.")
    args = parser.parse_args()

    if str(INDEXER_SRC) not in sys.path:
        sys.path.insert(0, str(INDEXER_SRC))

    from trask_indexer.chroma_store import (  # type: ignore[import-not-found]
        DEFAULT_COLLECTION,
        get_chroma_client,
        get_or_create_collection,
        purge_discord_message_rows,
    )

    data_dir = Path(os.environ.get("TRASK_INDEXER_DATA_DIR", REPO_ROOT / "data/trask-indexer"))
    collection = get_or_create_collection(get_chroma_client(data_dir / "chroma"), DEFAULT_COLLECTION)
    purged_ids = purge_discord_message_rows(
        collection,
        guild_id=args.guild_id or None,
        channel_id=args.channel_id,
        message_id=args.message_id,
        dry_run=args.dry_run,
    )
    print(
        json.dumps(
            {
                "ok": True,
                "dryRun": args.dry_run,
                "guildId": args.guild_id,
                "channelId": args.channel_id,
                "messageId": args.message_id,
                "matchedRows": len(purged_ids),
                "rowIds": purged_ids,
            },
            indent=2,
        ),
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
