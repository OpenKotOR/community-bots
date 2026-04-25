#!/usr/bin/env python3
"""Apply and verify Discord guild structure exports."""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import sys
import time
from typing import Any, Sequence
from urllib import error, request

DEFAULT_API_BASE = "https://discord.com/api/v10"
DEFAULT_CHANNEL_TYPES = {0, 2, 4, 5, 13, 14, 15, 16}
THREAD_CHANNEL_TYPES = {10, 11, 12}
ADMINISTRATOR_PERMISSION = 1 << 3


class DiscordApiError(RuntimeError):
    pass


@dataclass(frozen=True)
class ApiOptions:
    api_base: str
    timeout: float
    max_retries: int


@dataclass(frozen=True)
class TokenSource:
    token: str
    label: str


@dataclass
class MigrationSummary:
    target_guild_id: str
    source_guild_id: str
    source_role_count: int
    source_channel_count: int
    dry_run: bool = False
    created_roles: int = 0
    updated_roles: int = 0
    skipped_roles: int = 0
    created_channels: int = 0
    updated_channels: int = 0
    skipped_channels: int = 0
    positioned_roles: int = 0
    positioned_channels: int = 0
    warnings: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "target_guild_id": self.target_guild_id,
            "source_guild_id": self.source_guild_id,
            "source_role_count": self.source_role_count,
            "source_channel_count": self.source_channel_count,
            "dry_run": self.dry_run,
            "created_roles": self.created_roles,
            "updated_roles": self.updated_roles,
            "skipped_roles": self.skipped_roles,
            "created_or_updated_channels": self.created_channels + self.updated_channels,
            "created_channels": self.created_channels,
            "updated_channels": self.updated_channels,
            "skipped_channels": self.skipped_channels,
            "positioned_roles": self.positioned_roles,
            "positioned_channels": self.positioned_channels,
            "warnings": self.warnings,
        }


class Logger:
    def __init__(self, *, quiet: bool = False):
        self.quiet = quiet

    def info(self, message: str) -> None:
        if not self.quiet:
            print(safe_text(message))

    def warning(self, message: str) -> None:
        if not self.quiet:
            print(safe_text(f"Warning: {message}"), file=sys.stderr)


class DiscordApiClient:
    def __init__(self, token: str, options: ApiOptions):
        self._token = token
        self._options = options

    def request_json(self, method: str, endpoint: str, body: Any | None = None) -> Any:
        url = f"{self._options.api_base.rstrip('/')}{endpoint}"
        data: bytes | None = None
        headers = {
            "Authorization": f"Bot {self._token}",
            "User-Agent": "openkotor-discord-guild-migration/3.0",
        }
        if body is not None:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"

        for attempt in range(1, self._options.max_retries + 1):
            req = request.Request(url, data=data, headers=headers, method=method)
            try:
                with request.urlopen(req, timeout=self._options.timeout) as resp:
                    raw = resp.read().decode("utf-8", errors="replace")
                    if not raw:
                        return None
                    return json.loads(raw)
            except error.HTTPError as exc:
                response = exc.read().decode("utf-8", errors="replace")
                if exc.code == 429 and attempt < self._options.max_retries:
                    retry_after = retry_after_seconds(response, fallback=1.5)
                    time.sleep(max(retry_after, 0.2))
                    continue
                if exc.code >= 500 and attempt < self._options.max_retries:
                    time.sleep(1.2 * attempt)
                    continue
                raise DiscordApiError(f"Discord API {exc.code} {endpoint}: {response}") from exc

        raise DiscordApiError(f"Max retries exceeded for {method} {endpoint}")


def configure_stdio() -> None:
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(encoding="utf-8", errors="replace")


def safe_text(value: Any) -> str:
    return str(value).encode("utf-8", errors="replace").decode("utf-8", errors="replace")


def retry_after_seconds(raw_response: str, *, fallback: float) -> float:
    try:
        payload = json.loads(raw_response)
        return float(payload.get("retry_after", fallback))
    except Exception:
        return fallback


def parse_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        env[key.strip()] = value
    return env


def merged_environment(env_file: Path) -> dict[str, str]:
    values = parse_env(env_file)
    values.update({key: value for key, value in os.environ.items() if value is not None})
    return values


def resolve_token(args: argparse.Namespace, env: dict[str, str]) -> TokenSource:
    direct_token = getattr(args, "token", None)
    token_env = getattr(args, "token_env", None)
    if direct_token and token_env:
        raise SystemExit("Use either --token or --token-env, not both")
    if direct_token:
        return TokenSource(token=direct_token.strip(), label="--token")
    if token_env:
        token = env.get(token_env, "").strip()
        if not token:
            raise SystemExit(f"Missing token in environment for {token_env}")
        return TokenSource(token=token, label=token_env)
    raise SystemExit("Provide --token-env ENV_NAME or --token TOKEN")


def parse_int_set(value: str) -> set[int]:
    parsed: set[int] = set()
    for raw_part in value.split(","):
        part = raw_part.strip()
        if not part:
            continue
        parsed.add(int(part, 10))
    return parsed


def load_export(export_dir: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    guild_json_path = export_dir / "guild.json"
    manifest_path = export_dir / "manifest.json"
    if not guild_json_path.exists() or not manifest_path.exists():
        raise SystemExit(f"Export directory missing guild.json or manifest.json: {export_dir}")
    return (
        json.loads(guild_json_path.read_text(encoding="utf-8")),
        json.loads(manifest_path.read_text(encoding="utf-8")),
    )


def load_source_channels(export_dir: Path, manifest: dict[str, Any]) -> list[dict[str, Any]]:
    containers_dir = export_dir / "containers"
    channels_by_id: dict[str, dict[str, Any]] = {}
    for entry in manifest.get("containers", []):
        file_name = entry.get("file_name")
        if not file_name:
            continue
        container_file = containers_dir / file_name
        if not container_file.exists():
            continue
        payload = json.loads(container_file.read_text(encoding="utf-8"))
        raw_channel = (payload.get("channel") or {}).get("raw")
        if not isinstance(raw_channel, dict):
            continue
        channel_id = str(raw_channel.get("id") or "").strip()
        if not channel_id:
            continue
        channels_by_id[channel_id] = raw_channel

    channels = list(channels_by_id.values())
    channels.sort(key=lambda c: (int(c.get("position", 0)), str(c.get("id", ""))))
    return channels


def channel_type_counts(channels: Sequence[dict[str, Any]]) -> dict[int, int]:
    counts: dict[int, int] = {}
    for channel in channels:
        channel_type = int(channel.get("type", -1))
        counts[channel_type] = counts.get(channel_type, 0) + 1
    return counts


def channel_type_family(channel_type: int) -> str:
    if channel_type in {0, 5}:
        return "text"
    if channel_type in {2, 13}:
        return "voice"
    if channel_type in {15, 16}:
        return "forum"
    if channel_type == 4:
        return "category"
    return f"type:{channel_type}"


def sanitize_role_payload(role: dict[str, Any], *, include_role_icons: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": role.get("name") or "new-role",
        "permissions": str(role.get("permissions", "0")),
        "color": int(role.get("color", 0) or 0),
        "hoist": bool(role.get("hoist", False)),
        "mentionable": bool(role.get("mentionable", False)),
    }
    if include_role_icons:
        unicode_emoji = role.get("unicode_emoji")
        if unicode_emoji:
            payload["unicode_emoji"] = unicode_emoji
    return payload


def remap_overwrites(
    overwrites: list[dict[str, Any]],
    source_guild_id: str,
    target_guild_id: str,
    role_map: dict[str, str],
) -> list[dict[str, Any]]:
    mapped: list[dict[str, Any]] = []
    for overwrite in overwrites:
        overwrite_type = int(overwrite.get("type", 0))
        source_id = str(overwrite.get("id", ""))
        if overwrite_type != 0:
            continue
        target_id = target_guild_id if source_id == source_guild_id else role_map.get(source_id)
        if not target_id:
            continue
        mapped.append(
            {
                "id": target_id,
                "type": 0,
                "allow": str(overwrite.get("allow", "0")),
                "deny": str(overwrite.get("deny", "0")),
            }
        )
    return mapped


def sanitize_channel_payload(
    raw_channel: dict[str, Any],
    *,
    source_guild_id: str,
    target_guild_id: str,
    role_map: dict[str, str],
    parent_id: str | None,
    include_topics: bool,
    include_forum_tags: bool,
    include_default_reaction_emoji: bool,
    include_permission_overwrites: bool,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "name": raw_channel.get("name", "new-channel"),
        "type": int(raw_channel.get("type", 0)),
    }

    for key in (
        "nsfw",
        "bitrate",
        "user_limit",
        "rate_limit_per_user",
        "default_auto_archive_duration",
        "default_thread_rate_limit_per_user",
        "rtc_region",
        "video_quality_mode",
        "flags",
        "default_sort_order",
        "default_forum_layout",
    ):
        if key in raw_channel and raw_channel.get(key) is not None:
            payload[key] = raw_channel.get(key)

    if include_topics and raw_channel.get("topic") is not None:
        payload["topic"] = raw_channel.get("topic")
    if include_forum_tags and isinstance(raw_channel.get("available_tags"), list):
        payload["available_tags"] = raw_channel.get("available_tags")
    if include_default_reaction_emoji and raw_channel.get("default_reaction_emoji") is not None:
        payload["default_reaction_emoji"] = raw_channel.get("default_reaction_emoji")
    if parent_id:
        payload["parent_id"] = parent_id
    if include_permission_overwrites:
        overwrites = raw_channel.get("permission_overwrites") or []
        if isinstance(overwrites, list):
            payload["permission_overwrites"] = remap_overwrites(overwrites, source_guild_id, target_guild_id, role_map)

    return payload


def pick_existing_channel(
    existing_channels: list[dict[str, Any]],
    name: str,
    channel_type: int,
    parent_id: str | None,
    used_ids: set[str],
    *,
    match_channel_types: bool,
) -> dict[str, Any] | None:
    candidates = [
        channel
        for channel in existing_channels
        if str(channel.get("id")) not in used_ids
        and channel.get("name") == name
        and (
            int(channel.get("type", -1)) == channel_type
            if match_channel_types
            else channel_type_family(int(channel.get("type", -1))) == channel_type_family(channel_type)
        )
    ]
    if not candidates:
        return None
    if parent_id is not None:
        parent_match = [channel for channel in candidates if str(channel.get("parent_id")) == parent_id]
        if parent_match:
            return parent_match[0]
    return candidates[0]


def bot_highest_role_position(client: DiscordApiClient, guild_id: str, user_id: str, roles: Sequence[dict[str, Any]]) -> int:
    member_data = client.request_json("GET", f"/guilds/{guild_id}/members/{user_id}")
    member_roles = {str(role_id) for role_id in member_data.get("roles", [])}
    highest_position = -1
    for role in roles:
        if str(role.get("id")) in member_roles:
            highest_position = max(highest_position, int(role.get("position", -1)))
    return highest_position


def warn_or_raise(error_message: str, *, strict: bool, logger: Logger, summary: MigrationSummary | None = None) -> None:
    if strict:
        raise DiscordApiError(error_message)
    if summary is not None:
        summary.warnings.append(error_message)
    logger.warning(error_message)


def apply_roles(
    *,
    client: DiscordApiClient,
    logger: Logger,
    source_roles: list[dict[str, Any]],
    source_guild_id: str,
    target_guild_id: str,
    bot_user_id: str,
    summary: MigrationSummary,
    args: argparse.Namespace,
) -> dict[str, str]:
    destination_roles: list[dict[str, Any]] = list(client.request_json("GET", f"/guilds/{target_guild_id}/roles") or [])
    role_by_name = {role.get("name"): role for role in destination_roles if not role.get("managed")}
    role_position_by_id = {str(role.get("id")): int(role.get("position", -1)) for role in destination_roles}
    source_roles_sorted = sorted(source_roles, key=lambda role: int(role.get("position", 0)))
    role_map: dict[str, str] = {source_guild_id: target_guild_id}

    if args.skip_roles:
        for role in source_roles_sorted:
            existing = role_by_name.get(role.get("name"))
            if existing:
                role_map[str(role.get("id"))] = str(existing.get("id"))
        return role_map

    source_everyone = next((role for role in source_roles_sorted if str(role.get("id")) == source_guild_id), None)
    if source_everyone and not args.skip_everyone:
        payload = {"permissions": str(source_everyone.get("permissions", "0"))}
        try:
            if not args.dry_run:
                client.request_json("PATCH", f"/guilds/{target_guild_id}/roles/{target_guild_id}", payload)
            logger.info("Updated @everyone permissions" if not args.dry_run else "Would update @everyone permissions")
        except DiscordApiError as exc:
            warn_or_raise(f"Could not update @everyone permissions: {exc}", strict=args.strict, logger=logger, summary=summary)

    highest_position = bot_highest_role_position(client, target_guild_id, bot_user_id, destination_roles)
    logger.info(f"Bot highest role position: {highest_position}")

    for role in source_roles_sorted:
        source_role_id = str(role.get("id", ""))
        if source_role_id == source_guild_id or role.get("managed"):
            continue

        payload = sanitize_role_payload(role, include_role_icons=args.include_role_icons)
        existing = role_by_name.get(role.get("name"))
        if existing:
            destination_role_id = str(existing.get("id"))
            destination_position = int(existing.get("position", -1))
            role_map[source_role_id] = destination_role_id
            if destination_position >= highest_position:
                summary.skipped_roles += 1
                logger.info(
                    f"Skipping role {role.get('name')!r}: role position {destination_position} is at or above bot position {highest_position}"
                )
                continue
            try:
                if not args.dry_run:
                    client.request_json("PATCH", f"/guilds/{target_guild_id}/roles/{destination_role_id}", payload)
                summary.updated_roles += 1
            except DiscordApiError as exc:
                summary.skipped_roles += 1
                warn_or_raise(f"Could not update role {role.get('name')!r}: {exc}", strict=args.strict, logger=logger, summary=summary)
            continue

        try:
            if args.dry_run:
                destination_role_id = f"dry-run-role-{source_role_id}"
                created = {"id": destination_role_id, "name": role.get("name")}
            else:
                created = client.request_json("POST", f"/guilds/{target_guild_id}/roles", payload)
                destination_role_id = str(created.get("id"))
                destination_roles.append(created)
                role_position_by_id[destination_role_id] = int(created.get("position") or -1)
            role_by_name[role.get("name")] = created
            role_map[source_role_id] = destination_role_id
            summary.created_roles += 1
        except DiscordApiError as exc:
            summary.skipped_roles += 1
            warn_or_raise(f"Could not create role {role.get('name')!r}: {exc}", strict=args.strict, logger=logger, summary=summary)

    if not args.skip_role_positioning:
        role_positions_payload: list[dict[str, Any]] = []
        for role in source_roles_sorted:
            source_role_id = str(role.get("id", ""))
            mapped = role_map.get(source_role_id)
            if not mapped or mapped == target_guild_id or mapped.startswith("dry-run-role-"):
                continue
            if role_position_by_id.get(mapped, -1) >= highest_position:
                continue
            role_positions_payload.append({"id": mapped, "position": int(role.get("position", 0))})
        if role_positions_payload:
            try:
                if not args.dry_run:
                    client.request_json("PATCH", f"/guilds/{target_guild_id}/roles", role_positions_payload)
                summary.positioned_roles = len(role_positions_payload)
                logger.info(
                    f"Applied role positions for {len(role_positions_payload)} roles"
                    if not args.dry_run
                    else f"Would position {len(role_positions_payload)} roles"
                )
            except DiscordApiError as exc:
                warn_or_raise(f"Could not apply role positions: {exc}", strict=args.strict, logger=logger, summary=summary)

    return role_map


def apply_channels(
    *,
    client: DiscordApiClient,
    logger: Logger,
    source_channels: list[dict[str, Any]],
    source_guild_id: str,
    target_guild_id: str,
    role_map: dict[str, str],
    supported_channel_types: set[int],
    summary: MigrationSummary,
    args: argparse.Namespace,
) -> None:
    if args.skip_channels:
        return

    destination_channels: list[dict[str, Any]] = list(client.request_json("GET", f"/guilds/{target_guild_id}/channels") or [])
    source_categories = [channel for channel in source_channels if int(channel.get("type", -1)) == 4]
    source_non_categories = [
        channel
        for channel in source_channels
        if int(channel.get("type", -1)) in supported_channel_types and int(channel.get("type", -1)) != 4
    ]

    category_map: dict[str, str] = {}
    channel_map: dict[str, str] = {}
    used_existing_ids: set[str] = set()

    def upsert_channel(raw_channel: dict[str, Any], parent_id: str | None) -> str | None:
        source_channel_id = str(raw_channel.get("id"))
        payload = sanitize_channel_payload(
            raw_channel,
            source_guild_id=source_guild_id,
            target_guild_id=target_guild_id,
            role_map=role_map,
            parent_id=parent_id,
            include_topics=args.include_topics,
            include_forum_tags=args.include_forum_tags,
            include_default_reaction_emoji=args.include_default_reaction_emoji,
            include_permission_overwrites=not args.skip_permission_overwrites,
        )
        channel_type = int(payload.get("type", 0))
        existing = pick_existing_channel(
            destination_channels,
            str(payload["name"]),
            channel_type,
            parent_id,
            used_existing_ids,
            match_channel_types=args.match_channel_types,
        )
        if existing:
            destination_channel_id = str(existing.get("id"))
            used_existing_ids.add(destination_channel_id)
            patch_payload = dict(payload)
            patch_payload.pop("type", None)
            try:
                if not args.dry_run:
                    client.request_json("PATCH", f"/channels/{destination_channel_id}", patch_payload)
                summary.updated_channels += 1
                return destination_channel_id
            except DiscordApiError as exc:
                summary.skipped_channels += 1
                warn_or_raise(f"Could not update channel {payload.get('name')!r}: {exc}", strict=args.strict, logger=logger, summary=summary)
                return destination_channel_id

        try:
            if args.dry_run:
                destination_channel_id = f"dry-run-channel-{source_channel_id}"
                created = {"id": destination_channel_id, "name": payload.get("name"), "type": channel_type, "parent_id": parent_id}
            else:
                created = client.request_json("POST", f"/guilds/{target_guild_id}/channels", payload)
                destination_channel_id = str(created.get("id"))
                destination_channels.append(created)
            summary.created_channels += 1
            return destination_channel_id
        except DiscordApiError as exc:
            summary.skipped_channels += 1
            warn_or_raise(f"Could not create channel {payload.get('name')!r}: {exc}", strict=args.strict, logger=logger, summary=summary)
            return None

    for category in source_categories:
        source_id = str(category.get("id"))
        destination_id = upsert_channel(category, None)
        if destination_id:
            category_map[source_id] = destination_id
            channel_map[source_id] = destination_id

    for channel in source_non_categories:
        channel_type = int(channel.get("type", -1))
        if channel_type in THREAD_CHANNEL_TYPES:
            summary.skipped_channels += 1
            continue
        source_id = str(channel.get("id"))
        source_parent = str(channel.get("parent_id")) if channel.get("parent_id") else None
        destination_parent = category_map.get(source_parent) if source_parent else None
        destination_id = upsert_channel(channel, destination_parent)
        if destination_id:
            channel_map[source_id] = destination_id

    unsupported_channels = [
        channel for channel in source_channels if int(channel.get("type", -1)) not in supported_channel_types and int(channel.get("type", -1)) not in THREAD_CHANNEL_TYPES
    ]
    summary.skipped_channels += len(unsupported_channels)

    if args.skip_channel_positioning:
        return

    channel_position_payload: list[dict[str, Any]] = []
    for channel in source_channels:
        source_id = str(channel.get("id"))
        destination_id = channel_map.get(source_id)
        if not destination_id or destination_id.startswith("dry-run-channel-"):
            continue
        channel_position_payload.append({"id": destination_id, "position": int(channel.get("position", 0))})

    if channel_position_payload:
        try:
            if not args.dry_run:
                client.request_json("PATCH", f"/guilds/{target_guild_id}/channels", channel_position_payload)
            summary.positioned_channels = len(channel_position_payload)
            logger.info(
                f"Applied channel positions for {len(channel_position_payload)} channels"
                if not args.dry_run
                else f"Would position {len(channel_position_payload)} channels"
            )
        except DiscordApiError as exc:
            warn_or_raise(f"Could not apply channel positions: {exc}", strict=args.strict, logger=logger, summary=summary)


def run_apply(args: argparse.Namespace) -> int:
    env = merged_environment(Path(args.env_file))
    token_source = resolve_token(args, env)
    api_options = ApiOptions(api_base=args.api_base, timeout=args.timeout, max_retries=args.max_retries)
    client = DiscordApiClient(token_source.token, api_options)
    logger = Logger(quiet=args.quiet)

    export_dir = Path(args.export_dir)
    source, manifest = load_export(export_dir)
    source_guild = source.get("guild") or {}
    source_guild_id = str(source_guild.get("id") or "").strip()
    target_guild_id = str(args.target_guild_id).strip()
    if not source_guild_id or not target_guild_id:
        raise SystemExit("Both source and target guild IDs are required")

    source_roles: list[dict[str, Any]] = list(source_guild.get("roles") or [])
    source_channels = load_source_channels(export_dir, manifest)
    supported_channel_types = parse_int_set(args.channel_types)

    me = client.request_json("GET", "/users/@me")
    logger.info(f"Using bot: {me.get('username')} ({me.get('id')}) from {token_source.label}")

    summary = MigrationSummary(
        target_guild_id=target_guild_id,
        source_guild_id=source_guild_id,
        source_role_count=len(source_roles),
        source_channel_count=len(source_channels),
        dry_run=args.dry_run,
    )

    role_map = apply_roles(
        client=client,
        logger=logger,
        source_roles=source_roles,
        source_guild_id=source_guild_id,
        target_guild_id=target_guild_id,
        bot_user_id=str(me.get("id")),
        summary=summary,
        args=args,
    )
    apply_channels(
        client=client,
        logger=logger,
        source_channels=source_channels,
        source_guild_id=source_guild_id,
        target_guild_id=target_guild_id,
        role_map=role_map,
        supported_channel_types=supported_channel_types,
        summary=summary,
        args=args,
    )

    print(json.dumps(summary.as_dict(), indent=2, ensure_ascii=False))
    return 0


def parse_named_env(value: str) -> tuple[str, str]:
    if "=" not in value:
        return value, value
    label, env_name = value.split("=", 1)
    label = label.strip() or env_name.strip()
    env_name = env_name.strip()
    if not env_name:
        raise SystemExit(f"Invalid --required-bot-env value: {value}")
    return label, env_name


def bot_membership_summary(
    *,
    api_options: ApiOptions,
    env: dict[str, str],
    guild_id: str,
    bot_specs: Sequence[str],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for spec in bot_specs:
        label, env_name = parse_named_env(spec)
        token = env.get(env_name, "").strip()
        result: dict[str, Any] = {"label": label, "token_env": env_name, "present": False}
        if not token:
            result["error"] = "missing token"
            results.append(result)
            continue
        client = DiscordApiClient(token, api_options)
        try:
            me = client.request_json("GET", "/users/@me")
            member = client.request_json("GET", f"/guilds/{guild_id}/members/{me.get('id')}")
            result.update(
                {
                    "present": True,
                    "user_id": me.get("id"),
                    "username": me.get("username"),
                    "role_count": len(member.get("roles", [])),
                }
            )
        except DiscordApiError as exc:
            result["error"] = str(exc)
        results.append(result)
    return results


def admin_check_summary(
    *,
    api_options: ApiOptions,
    env: dict[str, str],
    guild_id: str,
    admin_token_envs: Sequence[str],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for env_name in admin_token_envs:
        token = env.get(env_name, "").strip()
        result: dict[str, Any] = {"token_env": env_name, "admin": False}
        if not token:
            result["error"] = "missing token"
            results.append(result)
            continue
        client = DiscordApiClient(token, api_options)
        try:
            me = client.request_json("GET", "/users/@me")
            member = client.request_json("GET", f"/guilds/{guild_id}/members/{me.get('id')}")
            roles = client.request_json("GET", f"/guilds/{guild_id}/roles")
            role_by_id = {str(role.get("id")): role for role in roles}
            permissions = 0
            role_names: list[str] = []
            for role_id in member.get("roles", []):
                role = role_by_id.get(str(role_id))
                if not role:
                    continue
                permissions |= int(role.get("permissions", "0"))
                role_names.append(str(role.get("name")))
            result.update(
                {
                    "admin": bool(permissions & ADMINISTRATOR_PERMISSION),
                    "user_id": me.get("id"),
                    "username": me.get("username"),
                    "roles": role_names,
                }
            )
        except DiscordApiError as exc:
            result["error"] = str(exc)
        results.append(result)
    return results


def compare_export_to_target(
    *,
    export_dir: Path,
    target_channels: list[dict[str, Any]],
    target_roles: list[dict[str, Any]],
    channel_types: set[int],
    match_channel_types: bool,
) -> dict[str, Any]:
    source, manifest = load_export(export_dir)
    source_guild = source.get("guild") or {}
    source_roles = [
        role
        for role in source_guild.get("roles", [])
        if not role.get("managed") and str(role.get("id")) != str(source_guild.get("id"))
    ]
    source_channels = load_source_channels(export_dir, manifest)
    comparable_channels = [
        channel
        for channel in source_channels
        if int(channel.get("type", -1)) in channel_types and int(channel.get("type", -1)) not in THREAD_CHANNEL_TYPES
    ]

    source_channel_counter: Counter[tuple[int | str, str]]
    target_channel_counter: Counter[tuple[int | str, str]]
    if match_channel_types:
        source_channel_counter = Counter((int(channel.get("type", -1)), str(channel.get("name"))) for channel in comparable_channels)
        target_channel_counter = Counter((int(channel.get("type", -1)), str(channel.get("name"))) for channel in target_channels)
    else:
        source_channel_counter = Counter((channel_type_family(int(channel.get("type", -1))), str(channel.get("name"))) for channel in comparable_channels)
        target_channel_counter = Counter((channel_type_family(int(channel.get("type", -1))), str(channel.get("name"))) for channel in target_channels)
    missing_channels: list[dict[str, Any]] = []
    for key, expected_count in source_channel_counter.items():
        actual_count = target_channel_counter.get(key, 0)
        if actual_count < expected_count:
            if match_channel_types:
                channel_type, name = key
                missing_channels.append({"type": channel_type, "name": name, "missing_count": expected_count - actual_count})
            else:
                channel_family, name = key
                missing_channels.append({"family": channel_family, "name": name, "missing_count": expected_count - actual_count})

    target_role_names = {str(role.get("name")) for role in target_roles}
    missing_roles = [str(role.get("name")) for role in source_roles if str(role.get("name")) not in target_role_names]

    return {
        "source_role_count": len(source_guild.get("roles", [])),
        "source_channel_count": len(source_channels),
        "comparable_source_channel_count": len(comparable_channels),
        "missing_roles": missing_roles,
        "missing_channels": missing_channels,
        "source_channel_types": channel_type_counts(source_channels),
    }


def run_verify(args: argparse.Namespace) -> int:
    env = merged_environment(Path(args.env_file))
    token_source = resolve_token(args, env)
    api_options = ApiOptions(api_base=args.api_base, timeout=args.timeout, max_retries=args.max_retries)
    client = DiscordApiClient(token_source.token, api_options)
    target_guild_id = str(args.target_guild_id).strip()
    target_roles: list[dict[str, Any]] = list(client.request_json("GET", f"/guilds/{target_guild_id}/roles") or [])
    target_channels: list[dict[str, Any]] = list(client.request_json("GET", f"/guilds/{target_guild_id}/channels") or [])
    channel_types = parse_int_set(args.channel_types)

    result: dict[str, Any] = {
        "target_guild_id": target_guild_id,
        "target_role_count": len(target_roles),
        "target_channel_count": len(target_channels),
        "target_channel_types": channel_type_counts(target_channels),
        "ok": True,
    }

    if args.export_dir:
        comparison = compare_export_to_target(
            export_dir=Path(args.export_dir),
            target_channels=target_channels,
            target_roles=target_roles,
            channel_types=channel_types,
            match_channel_types=args.match_channel_types,
        )
        result["export_comparison"] = comparison
        if comparison["missing_roles"] or comparison["missing_channels"]:
            result["ok"] = False

    if args.required_bot_env:
        bots = bot_membership_summary(
            api_options=api_options,
            env=env,
            guild_id=target_guild_id,
            bot_specs=args.required_bot_env,
        )
        result["required_bots"] = bots
        if any(not bot.get("present") for bot in bots):
            result["ok"] = False

    if args.require_admin_token_env:
        admin_checks = admin_check_summary(
            api_options=api_options,
            env=env,
            guild_id=target_guild_id,
            admin_token_envs=args.require_admin_token_env,
        )
        result["admin_checks"] = admin_checks
        if any(not check.get("admin") for check in admin_checks):
            result["ok"] = False

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print(f"Target guild: {target_guild_id}")
        print(f"Roles: {len(target_roles)}")
        print(f"Channels: {len(target_channels)}")
        print(f"Channel types: {result['target_channel_types']}")
        comparison_summary = result.get("export_comparison")
        if isinstance(comparison_summary, dict):
            print(f"Comparable source channels: {comparison_summary['comparable_source_channel_count']}")
            print(f"Missing roles: {len(comparison_summary['missing_roles'])}")
            print(f"Missing channels: {len(comparison_summary['missing_channels'])}")
        for bot in result.get("required_bots", []):
            status = "present" if bot.get("present") else f"missing ({bot.get('error', 'unknown error')})"
            print(f"Bot {bot['label']}: {status}")
        for check in result.get("admin_checks", []):
            status = "admin" if check.get("admin") else f"not admin ({check.get('error', 'no administrator permission')})"
            print(f"Admin check {check['token_env']}: {status}")
        print("Verification: OK" if result["ok"] else "Verification: FAILED")

    return 0 if result["ok"] or args.allow_incomplete else 1


def run_inspect(args: argparse.Namespace) -> int:
    source, manifest = load_export(Path(args.export_dir))
    source_guild = source.get("guild") or {}
    source_channels = load_source_channels(Path(args.export_dir), manifest)
    summary = {
        "source_guild_id": source_guild.get("id"),
        "source_guild_name": source_guild.get("name"),
        "role_count": len(source_guild.get("roles", [])),
        "channel_count": len(source_channels),
        "channel_types": channel_type_counts(source_channels),
        "manifest_stats": manifest.get("stats", {}),
    }
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--env-file", default=".env", help="Environment file to read before process environment values")
    parser.add_argument("--token-env", help="Environment variable containing the Discord bot token")
    parser.add_argument("--token", help="Discord bot token. Prefer --token-env for shell history safety")
    parser.add_argument("--api-base", default=DEFAULT_API_BASE, help="Discord API base URL")
    parser.add_argument("--timeout", type=float, default=30.0, help="HTTP timeout in seconds")
    parser.add_argument("--max-retries", type=int, default=6, help="Maximum attempts for rate-limited or transient API requests")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Apply and verify Discord guild structure exports")
    subparsers = parser.add_subparsers(dest="command", required=True)

    apply_parser = subparsers.add_parser("apply", help="Apply exported roles, channels, categories, and role overwrites")
    add_common_args(apply_parser)
    apply_parser.add_argument("--export-dir", required=True, help="Export directory containing guild.json, manifest.json, and containers")
    apply_parser.add_argument("--target-guild-id", required=True, help="Target Discord guild ID")
    apply_parser.add_argument("--channel-types", default=",".join(str(value) for value in sorted(DEFAULT_CHANNEL_TYPES)), help="Comma-separated channel types to apply")
    apply_parser.add_argument("--dry-run", action="store_true", help="Plan changes without mutating Discord")
    apply_parser.add_argument("--strict", action="store_true", help="Fail immediately on recoverable Discord API errors")
    apply_parser.add_argument("--quiet", action="store_true", help="Suppress progress logs and only print final JSON summary")
    apply_parser.add_argument("--skip-everyone", action="store_true", help="Do not update the target @everyone role")
    apply_parser.add_argument("--skip-roles", action="store_true", help="Do not create or update roles")
    apply_parser.add_argument("--skip-role-positioning", action="store_true", help="Do not reorder roles")
    apply_parser.add_argument("--skip-channels", action="store_true", help="Do not create or update channels")
    apply_parser.add_argument("--skip-channel-positioning", action="store_true", help="Do not reorder channels")
    apply_parser.add_argument("--skip-permission-overwrites", action="store_true", help="Do not apply role-based channel permission overwrites")
    apply_parser.add_argument("--match-channel-types", action="store_true", help="Only match existing channels when name and Discord channel type both match")
    apply_parser.add_argument("--include-topics", action="store_true", help="Apply channel topics. Can fail if topics contain inaccessible custom emoji")
    apply_parser.add_argument("--include-forum-tags", action="store_true", help="Apply forum/media available_tags. Can fail if tags contain inaccessible emoji")
    apply_parser.add_argument("--include-default-reaction-emoji", action="store_true", help="Apply default reaction emoji fields")
    apply_parser.add_argument("--include-role-icons", action="store_true", help="Apply role unicode emoji icons")
    apply_parser.set_defaults(func=run_apply)

    verify_parser = subparsers.add_parser("verify", help="Verify target guild state and required bot membership")
    add_common_args(verify_parser)
    verify_parser.add_argument("--target-guild-id", required=True, help="Target Discord guild ID")
    verify_parser.add_argument("--export-dir", help="Optional export directory to compare against the target guild")
    verify_parser.add_argument("--channel-types", default=",".join(str(value) for value in sorted(DEFAULT_CHANNEL_TYPES)), help="Comma-separated channel types to compare")
    verify_parser.add_argument("--match-channel-types", action="store_true", help="Require channels to match by both name and Discord channel type")
    verify_parser.add_argument("--required-bot-env", action="append", default=[], metavar="LABEL=ENV", help="Require a bot token env var to belong to the target guild. May be repeated")
    verify_parser.add_argument("--require-admin-token-env", action="append", default=[], metavar="ENV", help="Require a bot token env var to have Administrator in the target guild. May be repeated")
    verify_parser.add_argument("--allow-incomplete", action="store_true", help="Return exit code 0 even when verification finds missing items")
    verify_parser.add_argument("--json", action="store_true", help="Print machine-readable verification JSON")
    verify_parser.set_defaults(func=run_verify)

    inspect_parser = subparsers.add_parser("inspect", help="Print a summary of an export directory")
    inspect_parser.add_argument("--export-dir", required=True, help="Export directory containing guild.json and manifest.json")
    inspect_parser.set_defaults(func=run_inspect)

    return parser


def normalize_argv(argv: Sequence[str]) -> list[str]:
    if not argv or argv[0] in {"-h", "--help", "apply", "verify", "inspect"}:
        return list(argv)
    if argv[0].startswith("-"):
        return ["apply", *argv]
    return list(argv)


def main(argv: Sequence[str] | None = None) -> int:
    configure_stdio()
    parser = build_parser()
    args = parser.parse_args(normalize_argv(sys.argv[1:] if argv is None else argv))
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
