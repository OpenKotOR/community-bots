"""Health payload helpers for the retrieve API."""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_DISCORD_SYNC_STALE_HOURS = 48.0


def discord_sync_stale_hours() -> float:
    raw = os.environ.get("TRASK_DISCORD_SYNC_STALE_HOURS", "").strip()
    if not raw:
        return DEFAULT_DISCORD_SYNC_STALE_HOURS
    try:
        parsed = float(raw)
    except ValueError:
        return DEFAULT_DISCORD_SYNC_STALE_HOURS
    return max(0.0, parsed)


def _parse_sync_timestamp(value: str) -> datetime | None:
    text = value.strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def build_health_payload(
    data_dir: Path,
    *,
    collection: str,
    now: datetime | None = None,
) -> dict[str, object]:
    """Build GET /health JSON body."""
    payload: dict[str, object] = {"ok": True, "collection": collection}
    status_path = data_dir / "discord_sync_status.json"
    if not status_path.is_file():
        return payload

    try:
        status = json.loads(status_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return payload

    if not isinstance(status, dict):
        return payload

    last_sync_raw = status.get("last_discord_sync")
    if not isinstance(last_sync_raw, str) or not last_sync_raw.strip():
        return payload

    payload["last_discord_sync"] = last_sync_raw
    parsed = _parse_sync_timestamp(last_sync_raw)
    if parsed is None:
        return payload

    stale_after_hours = discord_sync_stale_hours()
    payload["discord_sync_stale_after_hours"] = stale_after_hours
    if stale_after_hours <= 0:
        payload["discord_sync_stale"] = False
        return payload

    reference = now or datetime.now(timezone.utc)
    age_hours = (reference.astimezone(timezone.utc) - parsed).total_seconds() / 3600.0
    payload["discord_sync_age_hours"] = round(age_hours, 2)
    payload["discord_sync_stale"] = age_hours > stale_after_hours
    return payload
