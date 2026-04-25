from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from enum import IntEnum
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, cast
from urllib import error, parse, request


DISCORD_API_BASE = "https://discord.com/api/v10"
DEFAULT_OUTPUT_ROOT = Path("exports")
DEFAULT_TIMEOUT_SECONDS = 30
DEFAULT_MAX_RETRIES = 6
DEFAULT_USER_AGENT = "openkotor-discord-bots-export/2.0"
MAX_EXTERNAL_ASSET_RETRY_AFTER_SECONDS = 30.0
MAX_EXTERNAL_ASSET_TRANSIENT_ATTEMPTS = 3

ANSI_RESET = "\033[0m"
ANSI_BOLD = "\033[1m"
ANSI_DIM = "\033[2m"


class LogLevel(IntEnum):
    DEBUG = 10
    INFO = 20
    WARNING = 30
    ERROR = 40
    SUCCESS = 50


LOG_LEVEL_NAMES: dict[str, LogLevel] = {
    "debug": LogLevel.DEBUG,
    "info": LogLevel.INFO,
    "warning": LogLevel.WARNING,
    "error": LogLevel.ERROR,
    "success": LogLevel.SUCCESS,
}

LOG_LEVEL_LABELS: dict[LogLevel, str] = {
    LogLevel.DEBUG: "DEBUG",
    LogLevel.INFO: "INFO ",
    LogLevel.WARNING: "WARN ",
    LogLevel.ERROR: "ERROR",
    LogLevel.SUCCESS: " OK  ",
}

LOG_LEVEL_COLORS: dict[LogLevel, str] = {
    LogLevel.DEBUG: "\033[36m",
    LogLevel.INFO: "\033[34m",
    LogLevel.WARNING: "\033[33m",
    LogLevel.ERROR: "\033[31m",
    LogLevel.SUCCESS: "\033[32m",
}

CHANNEL_TYPE_NAMES: dict[int, str] = {
    0: "guild_text",
    2: "guild_voice",
    4: "guild_category",
    5: "guild_announcement",
    10: "announcement_thread",
    11: "public_thread",
    12: "private_thread",
    13: "guild_stage_voice",
    14: "guild_directory",
    15: "guild_forum",
    16: "guild_media",
}

TOP_LEVEL_MESSAGE_CHANNEL_TYPES = {0, 5}
THREAD_CHANNEL_TYPES = {10, 11, 12}
THREAD_PARENT_TYPES = {0, 5, 15, 16}
METADATA_ONLY_CHANNEL_TYPES = {2, 4, 13, 14, 15, 16}


class DiscordApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, path: str | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.path = path


def format_exception_for_log(exc: BaseException) -> str:
    if isinstance(exc, DiscordApiError):
        detail = str(exc)

        if exc.status_code is not None and exc.path is not None:
            prefix = f"Discord API {exc.status_code} for {exc.path}: "
            if detail.startswith(prefix):
                detail = detail[len(prefix):]
            return f"status={exc.status_code} path={exc.path} detail={detail}"

        if exc.path is not None:
            return f"path={exc.path} detail={detail}"

    return str(exc)


@dataclass(slots=True)
class ExportOptions:
    token: str
    guild_id: str
    output_root: Path
    output_dir: Path | None
    output_file: Path | None
    include_channels: set[str]
    exclude_channels: set[str]
    exclude_channel_types: set[str]
    include_archived_threads: bool
    include_private_archived_threads: bool
    metadata_only: bool
    download_assets: bool
    include_reaction_users: bool
    resume: bool
    max_messages_per_container: int | None
    strict: bool
    log_level: LogLevel
    color: bool
    json_summary: bool
    timeout_seconds: int
    max_retries: int


class Logger:
    def __init__(self, *, level: LogLevel, color: bool) -> None:
        self._level = level
        self._color = color

    def debug(self, message: str) -> None:
        self._emit(LogLevel.DEBUG, message)

    def info(self, message: str) -> None:
        self._emit(LogLevel.INFO, message)

    def warning(self, message: str) -> None:
        self._emit(LogLevel.WARNING, message)

    def error(self, message: str) -> None:
        self._emit(LogLevel.ERROR, message)

    def success(self, message: str) -> None:
        self._emit(LogLevel.SUCCESS, message)

    def _emit(self, level: LogLevel, message: str) -> None:
        if level < self._level:
            return

        timestamp = utc_now().strftime("%H:%M:%S")
        label = LOG_LEVEL_LABELS[level]
        if self._color:
            color = LOG_LEVEL_COLORS[level]
            rendered = f"{ANSI_DIM}{timestamp}{ANSI_RESET} {ANSI_BOLD}{color}[{label}]{ANSI_RESET} {message}"
        else:
            rendered = f"{timestamp} [{label}] {message}"

        print(rendered, file=sys.stderr)


def is_disk_full_error(exc: BaseException) -> bool:
    return isinstance(exc, OSError) and exc.errno == 28


def is_atomic_replace_retryable_error(exc: BaseException) -> bool:
    return isinstance(exc, OSError) and getattr(exc, "winerror", None) in {5, 32}


def replace_with_retry(source: Path, destination: Path, *, attempts: int = 6) -> None:
    last_error: OSError | None = None

    for attempt in range(1, attempts + 1):
        try:
            os.replace(source, destination)
            return
        except OSError as exc:
            if not is_atomic_replace_retryable_error(exc) or attempt == attempts:
                raise
            last_error = exc
            time.sleep(0.1 * attempt)

    if last_error is not None:
        raise last_error


def write_bytes_atomic(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")

    try:
        with temp_path.open("wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        replace_with_retry(temp_path, path)
    except OSError:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


class AssetStore:
    def __init__(
        self,
        *,
        root: Path,
        base_path: Path,
        client: DiscordApiClient,
        logger: Logger,
        existing_records: list[dict[str, Any]] | None = None,
    ) -> None:
        self._root = root
        self._base_path = base_path
        self._client = client
        self._logger = logger
        self._records_by_url: dict[str, dict[str, Any]] = {}
        self._records: list[dict[str, Any]] = []
        self._next_id = 1

        for record in existing_records or []:
            if not isinstance(record, dict):
                continue
            self._ensure_source_claims(record)
            self._records.append(record)
            record_id = int(record.get("id", 0))
            if record_id >= self._next_id:
                self._next_id = record_id + 1
            self._register_record_urls(record)

    def fetch(
        self,
        *,
        url: str | None,
        fallback_url: str | None = None,
        category: str,
        suggested_name: str,
        source_kind: str,
        source_ref: dict[str, Any],
    ) -> dict[str, Any] | None:
        if not url:
            return None

        existing = self._records_by_url.get(url)
        if existing is not None:
            self._append_source_claim(existing, source_kind=source_kind, source_ref=source_ref)
            if self._record_is_usable(existing):
                return existing
            if not self._record_should_retry(existing):
                return existing



        target_dir = self._root / slugify(category, "assets")
        target_dir.mkdir(parents=True, exist_ok=True)

        stem = slugify(Path(suggested_name).stem or source_kind, source_kind)
        suffix = Path(suggested_name).suffix or self._suffix_from_url(url)
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
        file_name = f"{digest}-{stem}{suffix}"
        target_path = target_dir / file_name

        chosen_url = url
        content_type: str | None = None
        last_error: str | None = None

        for candidate in [url, fallback_url]:
            if not candidate:
                continue
            try:
                payload, content_type = self._client.request_bytes(candidate)
                write_bytes_atomic(target_path, payload)
                chosen_url = candidate
                last_error = None
                break
            except OSError as exc:
                if is_disk_full_error(exc):
                    raise
                last_error = str(exc)
            except Exception as exc:
                last_error = str(exc)

        if last_error is not None:
            error_status_code = last_status_code(last_error)
            self._logger.warning(f"Asset download failed for {source_kind}: {url} ({last_error})")
            record = {
                "id": self._next_id,
                "source_kind": source_kind,
                "source_ref": source_ref,
                "source_claims": [{"source_kind": source_kind, "source_ref": source_ref}],
                "status": "error",
                "url": url,
                "fallback_url": fallback_url,
                "error": last_error,
                "error_status_code": error_status_code,
            }
            self._next_id += 1
            self._register_record_urls(record)
            self._records.append(record)
            return record

        relative_path = self._relative_path(target_path)
        record = {
            "id": self._next_id,
            "source_kind": source_kind,
            "source_ref": source_ref,
            "source_claims": [{"source_kind": source_kind, "source_ref": source_ref}],
            "status": "downloaded",
            "url": chosen_url,
            "fallback_url": fallback_url,
            "content_type": content_type,
            "path": relative_path,
            "size_bytes": target_path.stat().st_size,
        }
        self._next_id += 1
        self._register_record_urls(record, extra_urls=[url])
        self._records.append(record)
        return record

    def manifest(self) -> list[dict[str, Any]]:
        return list(self._records)

    def _relative_path(self, path: Path) -> str:
        try:
            return path.relative_to(self._base_path).as_posix()
        except ValueError:
            return str(path)

    def _register_record_urls(self, record: dict[str, Any], extra_urls: list[str] | None = None) -> None:
        for candidate in [record.get("url"), record.get("fallback_url"), *(extra_urls or [])]:
            candidate_url = str(candidate or "").strip()
            if candidate_url:
                self._records_by_url[candidate_url] = record

    def _ensure_source_claims(self, record: dict[str, Any]) -> None:
        claims = record.get("source_claims")
        if isinstance(claims, list):
            normalized_claims = [claim for claim in claims if self._is_valid_source_claim(claim)]
            if normalized_claims:
                record["source_claims"] = normalized_claims
                return

        source_kind = str(record.get("source_kind") or "").strip()
        source_ref = record.get("source_ref")
        if source_kind and isinstance(source_ref, dict):
            record["source_claims"] = [{"source_kind": source_kind, "source_ref": source_ref}]
        else:
            record["source_claims"] = []

    def _append_source_claim(self, record: dict[str, Any], *, source_kind: str, source_ref: dict[str, Any]) -> None:
        self._ensure_source_claims(record)
        claim = {"source_kind": source_kind, "source_ref": source_ref}
        source_claims = cast(list[dict[str, Any]], record["source_claims"])
        if any(existing_claim == claim for existing_claim in source_claims):
            return
        source_claims.append(claim)

    def _is_valid_source_claim(self, claim: Any) -> bool:
        if not isinstance(claim, dict):
            return False
        source_kind = str(claim.get("source_kind") or "").strip()
        source_ref = claim.get("source_ref")
        return bool(source_kind and isinstance(source_ref, dict))

    def _suffix_from_url(self, url: str) -> str:
        parsed = parse.urlparse(url)
        return Path(parsed.path).suffix

    def _record_is_usable(self, record: dict[str, Any]) -> bool:
        if record.get("status") != "downloaded":
            return False
        relative_path = str(record.get("path") or "").strip()
        if not relative_path:
            return False
        return (self._base_path / Path(relative_path)).exists()

    def _record_should_retry(self, record: dict[str, Any]) -> bool:
        if record.get("status") != "error":
            return True
        status_code = self._error_status_code(record)
        return status_code in {429, 500, 502, 503, 504}

    def _error_status_code(self, record: dict[str, Any]) -> int | None:
        raw_status_code = record.get("error_status_code")
        if isinstance(raw_status_code, int):
            return raw_status_code
        if isinstance(raw_status_code, str) and raw_status_code.isdigit():
            return int(raw_status_code)
        error_message = str(record.get("error") or "")
        return last_status_code(error_message)


def last_status_code(message: str) -> int | None:
    match = re.search(r"\b(?:Discord API|Asset fetch)\s+(\d{3})\b", message)
    if not match:
        return None
    return int(match.group(1))


def optional_resource_status_map(optional_resource_errors: list[dict[str, Any]]) -> dict[str, str]:
    statuses: dict[str, str] = {}
    for entry in optional_resource_errors:
        if not isinstance(entry, dict):
            continue
        resource_name = str(entry.get("resource") or "").strip()
        if not resource_name:
            continue
        error_message = str(entry.get("error") or "")
        status_code = last_status_code(error_message)
        statuses[resource_name] = f"unavailable:{status_code}" if status_code is not None else "unavailable"
    return statuses


def build_guild_resource_summary(
    *,
    optional_resource_errors: list[dict[str, Any]],
    welcome_screen: Any,
    soundboard_sounds: Any,
    vanity_url: Any,
    guild_widget: Any,
    widget_settings: Any,
    widget_member_count: int,
    widget_image_style_count: int,
) -> dict[str, Any]:
    optional_resource_statuses = optional_resource_status_map(optional_resource_errors)
    return {
        "welcome_screen": optional_resource_statuses.get("welcome_screen", "ok" if welcome_screen is not None else "absent"),
        "soundboard_sound_count": len(soundboard_sounds) if isinstance(soundboard_sounds, list) else 0,
        "vanity_url": optional_resource_statuses.get("vanity_url", "ok" if vanity_url is not None else "absent"),
        "widget_json": "ok" if guild_widget is not None else optional_resource_statuses.get("widget", "absent"),
        "widget_settings": optional_resource_statuses.get("widget_settings", "ok" if widget_settings is not None else "absent"),
        "widget_member_count": widget_member_count,
        "widget_image_style_count": widget_image_style_count,
    }


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_now_iso() -> str:
    return utc_now().replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slugify(value: str, fallback: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return normalized or fallback


def find_dotenv(start_dir: Path) -> Path | None:
    current = start_dir.resolve()
    while True:
        candidate = current / ".env"
        if candidate.exists():
            return candidate
        if current.parent == current:
            return None
        current = current.parent


def load_env_file(env_path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()

        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]

        values[key] = value

    return values


def merge_environment(env_file_values: dict[str, str]) -> dict[str, str]:
    merged = dict(env_file_values)
    for key, value in os.environ.items():
        merged[key] = value
    return merged


def normalize_match_key(value: str) -> str:
    return value.casefold().lstrip("#").strip()


def parse_repeated_text(values: list[str] | None) -> set[str]:
    result: set[str] = set()
    if not values:
        return result

    for value in values:
        for item in value.split(","):
            normalized = normalize_match_key(item)
            if normalized:
                result.add(normalized)
    return result


def safe_json_loads(raw_value: str) -> Any:
    if not raw_value:
        return None
    return json.loads(raw_value)


def is_external_embed_asset_url(url: str) -> bool:
    parsed = parse.urlparse(url)
    host = parsed.netloc.casefold()
    return host.endswith("discordapp.net") and "/external/" in parsed.path.casefold()


def is_third_party_asset_url(url: str) -> bool:
    parsed = parse.urlparse(url)
    host = parsed.netloc.casefold()
    if is_external_embed_asset_url(url):
        return True
    discord_hosts = (
        "discord.com",
        "discordapp.com",
        "discordapp.net",
        "discordcdn.com",
    )
    return not any(host == candidate or host.endswith(f".{candidate}") for candidate in discord_hosts)


class DiscordApiClient:
    def __init__(self, token: str, *, timeout_seconds: int, max_retries: int, logger: Logger) -> None:
        self._token = token
        self._timeout_seconds = timeout_seconds
        self._max_retries = max_retries
        self._logger = logger

    def request_json(self, path: str, query: dict[str, Any] | None = None) -> Any:
        url = f"{DISCORD_API_BASE}{path}"
        if query:
            encoded = parse.urlencode({key: value for key, value in query.items() if value is not None})
            url = f"{url}?{encoded}"

        return self._request_json_url(url, path=path)

    def request_public_json(self, url: str) -> Any:
        return self._request_json_url(url, path=url)

    def _request_json_url(self, url: str, *, path: str) -> Any:
        for attempt in range(1, self._max_retries + 1):
            req = request.Request(
                url,
                headers={
                    "Authorization": f"Bot {self._token}",
                    "User-Agent": DEFAULT_USER_AGENT,
                },
            )

            try:
                with request.urlopen(req, timeout=self._timeout_seconds) as response:
                    raw_body = response.read().decode("utf-8")
                    return safe_json_loads(raw_body)
            except error.HTTPError as exc:
                raw_body = exc.read().decode("utf-8", errors="replace")
                retry_after = self._extract_retry_after(exc.headers, raw_body)

                if exc.code == 429 and attempt < self._max_retries:
                    self._logger.warning(
                        f"Rate limited on {path}; retrying in {retry_after:.2f}s (attempt {attempt}/{self._max_retries})."
                    )
                    time.sleep(retry_after)
                    continue

                if exc.code in {500, 502, 503, 504} and attempt < self._max_retries:
                    delay = max(retry_after, min(2 ** (attempt - 1), 10))
                    self._logger.warning(
                        f"Transient Discord error {exc.code} on {path}; retrying in {delay:.2f}s (attempt {attempt}/{self._max_retries})."
                    )
                    time.sleep(delay)
                    continue

                raise DiscordApiError(
                    f"Discord API {exc.code} for {path}: {raw_body}",
                    status_code=exc.code,
                    path=path,
                ) from exc
            except error.URLError as exc:
                if attempt < self._max_retries:
                    delay = min(2 ** (attempt - 1), 10)
                    self._logger.warning(
                        f"Network error on {path}: {exc}. Retrying in {delay:.2f}s (attempt {attempt}/{self._max_retries})."
                    )
                    time.sleep(delay)
                    continue
                raise DiscordApiError(f"Network error for {path}: {exc}", path=path) from exc

        raise DiscordApiError(f"Exhausted retries for {path}", path=path)

    def request_bytes(self, url: str) -> tuple[bytes, str | None]:
        third_party_asset = is_third_party_asset_url(url)
        for attempt in range(1, self._max_retries + 1):
            req = request.Request(
                url,
                headers={
                    "User-Agent": DEFAULT_USER_AGENT,
                },
            )

            try:
                with request.urlopen(req, timeout=self._timeout_seconds) as response:
                    content_type = response.headers.get("Content-Type")
                    return response.read(), content_type
            except error.HTTPError as exc:
                raw_body = exc.read().decode("utf-8", errors="replace")
                retry_after = self._extract_retry_after(exc.headers, raw_body)

                if exc.code == 429 and attempt < self._max_retries:
                    if retry_after > MAX_EXTERNAL_ASSET_RETRY_AFTER_SECONDS:
                        raise DiscordApiError(
                            f"Asset fetch {exc.code} for {url}: retry_after={retry_after:.2f}s exceeds asset retry threshold",
                            status_code=exc.code,
                            path=url,
                        ) from exc
                    self._logger.warning(
                        f"Rate limited on asset URL; retrying in {retry_after:.2f}s (attempt {attempt}/{self._max_retries})."
                    )
                    time.sleep(retry_after)
                    continue

                if exc.code in {500, 502, 503, 504} and attempt < self._max_retries:
                    if third_party_asset and attempt >= MAX_EXTERNAL_ASSET_TRANSIENT_ATTEMPTS:
                        raise DiscordApiError(
                            f"Asset fetch {exc.code} for {url}: exceeded third-party transient retry threshold",
                            status_code=exc.code,
                            path=url,
                        ) from exc
                    delay = max(retry_after, min(2 ** (attempt - 1), 10))
                    self._logger.warning(
                        f"Transient asset fetch error {exc.code}; retrying in {delay:.2f}s (attempt {attempt}/{self._max_retries})."
                    )
                    time.sleep(delay)
                    continue

                raise DiscordApiError(f"Asset fetch {exc.code} for {url}: {raw_body}", status_code=exc.code, path=url) from exc
            except error.URLError as exc:
                if attempt < self._max_retries:
                    if third_party_asset and attempt >= MAX_EXTERNAL_ASSET_TRANSIENT_ATTEMPTS:
                        raise DiscordApiError(
                            f"Network error for asset URL {url}: exceeded third-party transient retry threshold ({exc})",
                            path=url,
                        ) from exc
                    delay = min(2 ** (attempt - 1), 10)
                    self._logger.warning(
                        f"Network error on asset URL {url}: {exc}. Retrying in {delay:.2f}s (attempt {attempt}/{self._max_retries})."
                    )
                    time.sleep(delay)
                    continue
                raise DiscordApiError(f"Network error for asset URL {url}: {exc}", path=url) from exc

        raise DiscordApiError(f"Exhausted retries for asset URL {url}", path=url)

    def _extract_retry_after(self, headers: Any, raw_body: str) -> float:
        header_value = None
        if headers is not None:
            header_value = headers.get("Retry-After") or headers.get("retry-after")
        if header_value:
            try:
                return max(float(header_value), 0.5)
            except ValueError:
                pass

        try:
            body = safe_json_loads(raw_body)
            if isinstance(body, dict) and "retry_after" in body:
                return max(float(body["retry_after"]), 0.5)
        except Exception:
            pass

        return 1.0

def channel_type_name(channel_type: int) -> str:
    return CHANNEL_TYPE_NAMES.get(channel_type, f"unknown_{channel_type}")


def is_selected_container(channel: dict[str, Any], include_channels: set[str], exclude_channels: set[str], exclude_channel_types: set[str]) -> bool:
    channel_id = str(channel.get("id", "")).strip()
    channel_name = normalize_match_key(str(channel.get("name", "")))
    type_name = channel_type_name(int(channel.get("type", -1)))

    if type_name in exclude_channel_types:
        return False

    identifiers = {channel_id, channel_name}
    if str(channel.get("parent_id", "")).strip():
        identifiers.add(str(channel.get("parent_id", "")).strip())

    if include_channels and not identifiers.intersection(include_channels):
        return False

    if identifiers.intersection(exclude_channels):
        return False

    return True


def sort_channels(channels: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        channels,
        key=lambda channel: (
            int(channel.get("type", -1)),
            int(channel.get("position", 0)),
            str(channel.get("parent_id", "")),
            str(channel.get("name", "")).casefold(),
            str(channel.get("id", "")),
        ),
    )


def sort_threads(threads: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        threads,
        key=lambda channel: (
            str(channel.get("parent_id", "")),
            str(channel.get("thread_metadata", {}).get("archive_timestamp", "")),
            str(channel.get("name", "")).casefold(),
            str(channel.get("id", "")),
        ),
    )


def export_messages(client: DiscordApiClient, channel_id: str, max_messages: int | None) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = []
    before: str | None = None

    while True:
        remaining = None if max_messages is None else max_messages - len(messages)
        if remaining is not None and remaining <= 0:
            break

        limit = 100 if remaining is None else min(100, remaining)
        page = client.request_json(f"/channels/{channel_id}/messages", {"limit": limit, "before": before})
        if not isinstance(page, list):
            raise DiscordApiError(f"Unexpected response shape while fetching messages for {channel_id}")

        if not page:
            break

        messages.extend(page)
        before = str(page[-1]["id"])

    messages.reverse()
    return messages


def fetch_archived_threads(client: DiscordApiClient, parent_channel_id: str, archived_kind: str) -> list[dict[str, Any]]:
    threads: list[dict[str, Any]] = []
    before: str | None = None

    while True:
        path = f"/channels/{parent_channel_id}/{archived_kind}"
        page = client.request_json(path, {"limit": 100, "before": before})
        if not isinstance(page, dict):
            raise DiscordApiError(f"Unexpected archived thread response for {parent_channel_id} ({archived_kind})")

        batch = page.get("threads", [])
        if not isinstance(batch, list) or not batch:
            break

        threads.extend(batch)

        last_thread = batch[-1]
        metadata = last_thread.get("thread_metadata", {}) if isinstance(last_thread, dict) else {}
        before = str(metadata.get("archive_timestamp", "")).strip() or None
        if not page.get("has_more") or before is None:
            break

    return threads


def fetch_all_members(client: DiscordApiClient, guild_id: str) -> list[dict[str, Any]]:
    members: list[dict[str, Any]] = []
    after: str | None = None

    while True:
        page = client.request_json(f"/guilds/{guild_id}/members", {"limit": 1000, "after": after})
        if not isinstance(page, list):
            raise DiscordApiError(f"Unexpected guild member response for guild {guild_id}")
        if not page:
            break
        members.extend(page)
        after = str(page[-1].get("user", {}).get("id", "")).strip() or None
        if len(page) < 1000 or after is None:
            break

    return members


def encode_reaction_emoji(emoji: dict[str, Any]) -> str:
    emoji_id = emoji.get("id")
    emoji_name = str(emoji.get("name") or "")
    if emoji_id:
        return parse.quote(f"{emoji_name}:{emoji_id}", safe="")
    return parse.quote(emoji_name, safe="")


def fetch_reaction_users(
    client: DiscordApiClient,
    *,
    channel_id: str,
    message_id: str,
    emoji: dict[str, Any],
) -> list[dict[str, Any]]:
    encoded_emoji = encode_reaction_emoji(emoji)
    users: list[dict[str, Any]] = []
    after: str | None = None

    while True:
        page = client.request_json(
            f"/channels/{channel_id}/messages/{message_id}/reactions/{encoded_emoji}",
            {"limit": 100, "after": after},
        )
        if not isinstance(page, list):
            raise DiscordApiError(f"Unexpected reaction user response for message {message_id}")
        if not page:
            break
        users.extend(page)
        after = str(page[-1].get("id", "")).strip() or None
        if len(page) < 100 or after is None:
            break

    return users


def build_avatar_url(user: dict[str, Any]) -> str | None:
    user_id = str(user.get("id", "")).strip()
    avatar_hash = str(user.get("avatar") or "").strip()
    if not user_id or not avatar_hash:
        return None
    extension = "gif" if avatar_hash.startswith("a_") else "png"
    return f"https://cdn.discordapp.com/avatars/{user_id}/{avatar_hash}.{extension}?size=4096"


def build_user_banner_url(user: dict[str, Any]) -> str | None:
    user_id = str(user.get("id", "")).strip()
    banner_hash = str(user.get("banner") or "").strip()
    if not user_id or not banner_hash:
        return None
    extension = "gif" if banner_hash.startswith("a_") else "png"
    return f"https://cdn.discordapp.com/banners/{user_id}/{banner_hash}.{extension}?size=4096"


def build_member_avatar_url(guild_id: str, member: dict[str, Any]) -> str | None:
    user = member.get("user") if isinstance(member.get("user"), dict) else None
    user_id = str(user.get("id", "")).strip() if isinstance(user, dict) else ""
    avatar_hash = str(member.get("avatar") or "").strip()
    if not guild_id or not user_id or not avatar_hash:
        return None
    extension = "gif" if avatar_hash.startswith("a_") else "png"
    return f"https://cdn.discordapp.com/guilds/{guild_id}/users/{user_id}/avatars/{avatar_hash}.{extension}?size=4096"


def asset_context_slug(value: str) -> str:
    slug = "".join(character if character.isalnum() else "-" for character in value)
    slug = slug.strip("-")
    return slug or "message"


def build_guild_asset_candidates(guild: dict[str, Any]) -> list[dict[str, Any]]:
    guild_id = str(guild.get("id", "")).strip()
    if not guild_id:
        return []

    candidates: list[dict[str, Any]] = []
    for field_name in ["icon", "banner", "splash", "discovery_splash"]:
        asset_hash = str(guild.get(field_name) or "").strip()
        if not asset_hash:
            continue
        extension = "gif" if asset_hash.startswith("a_") else "png"
        candidates.append(
            {
                "source_kind": f"guild_{field_name}",
                "url": f"https://cdn.discordapp.com/{field_name}s/{guild_id}/{asset_hash}.{extension}?size=4096",
                "suggested_name": f"{field_name}.{extension}",
            }
        )
    return candidates


def build_role_icon_url(role: dict[str, Any]) -> str | None:
    role_id = str(role.get("id", "")).strip()
    icon_hash = str(role.get("icon") or "").strip()
    if not role_id or not icon_hash:
        return None
    return f"https://cdn.discordapp.com/roles/{role_id}/icons/{icon_hash}.png?size=4096"


def build_avatar_decoration_url(user: dict[str, Any]) -> str | None:
    decoration = user.get("avatar_decoration_data") if isinstance(user.get("avatar_decoration_data"), dict) else None
    asset = str(decoration.get("asset") or "").strip() if isinstance(decoration, dict) else ""
    if not asset:
        return None
    return f"https://media.discordapp.net/avatar-decoration-presets/{asset}.png?size=4096"


def get_collectible_nameplate(user: dict[str, Any]) -> dict[str, Any] | None:
    collectibles = user.get("collectibles") if isinstance(user.get("collectibles"), dict) else None
    nameplate = collectibles.get("nameplate") if isinstance(collectibles, dict) else None
    if not isinstance(nameplate, dict):
        return None

    asset_path = str(nameplate.get("asset") or "").strip()
    if not asset_path:
        return None

    return {
        "status": "unresolved_asset_path",
        "asset_path": asset_path,
        "sku_id": nameplate.get("sku_id"),
        "label": nameplate.get("label"),
        "palette": nameplate.get("palette"),
    }


def get_display_name_style_metadata(user: dict[str, Any]) -> dict[str, Any] | None:
    display_name_styles = user.get("display_name_styles") if isinstance(user.get("display_name_styles"), dict) else None
    if not isinstance(display_name_styles, dict):
        return None

    font_id = display_name_styles.get("font_id")
    effect_id = display_name_styles.get("effect_id")
    colors = display_name_styles.get("colors") if isinstance(display_name_styles.get("colors"), list) else None
    normalized_colors = [color for color in colors if isinstance(color, int)] if isinstance(colors, list) else []

    if font_id is None and effect_id is None and not normalized_colors:
        return None

    return {
        "status": "style_metadata",
        "font_id": font_id,
        "effect_id": effect_id,
        "colors": normalized_colors,
    }


def build_clan_badge_url(clan: dict[str, Any]) -> str | None:
    identity_guild_id = str(clan.get("identity_guild_id") or "").strip()
    badge_hash = str(clan.get("badge") or "").strip()
    if not identity_guild_id or not badge_hash:
        return None
    return f"https://media.discordapp.net/clan-badges/{identity_guild_id}/{badge_hash}.png?size=4096"


def build_scheduled_event_cover_url(event: dict[str, Any]) -> str | None:
    event_id = str(event.get("id", "")).strip()
    image_hash = str(event.get("image") or "").strip()
    if not event_id or not image_hash:
        return None
    extension = "gif" if image_hash.startswith("a_") else "png"
    return f"https://cdn.discordapp.com/guild-events/{event_id}/{image_hash}.{extension}?size=4096"


def build_emoji_asset_url(emoji: dict[str, Any]) -> str | None:
    emoji_id = str(emoji.get("id") or "").strip()
    if not emoji_id:
        return None
    extension = "gif" if emoji.get("animated") else "png"
    return f"https://cdn.discordapp.com/emojis/{emoji_id}.{extension}?size=4096&quality=lossless"


def build_sticker_asset_url(sticker: dict[str, Any]) -> str | None:
    sticker_id = str(sticker.get("id", "")).strip()
    if not sticker_id:
        return None
    format_type = int(sticker.get("format_type", 0))
    extension = {1: "png", 2: "png", 3: "json", 4: "gif"}.get(format_type, "png")
    return f"https://cdn.discordapp.com/stickers/{sticker_id}.{extension}"


def build_soundboard_sound_asset_url(sound: dict[str, Any]) -> str | None:
    sound_id = str(sound.get("sound_id") or sound.get("id") or "").strip()
    if not sound_id:
        return None
    return f"https://cdn.discordapp.com/soundboard-sounds/{sound_id}"


def build_guild_widget_image_url(guild_id: str, *, style: str = "banner2") -> str | None:
    guild_id = guild_id.strip()
    if not guild_id:
        return None
    return f"https://discord.com/api/guilds/{guild_id}/widget.png?style={style}"


def iter_guild_widget_image_styles() -> list[str]:
    return ["shield", "banner1", "banner2", "banner3", "banner4"]


def message_payload_needs_assets(message: dict[str, Any], *, depth: int = 0) -> bool:
    if depth > 4:
        return False

    author = message.get("author")
    if isinstance(author, dict) and build_avatar_url(author):
        return True
    if isinstance(author, dict) and build_user_banner_url(author):
        return True
    if isinstance(author, dict) and build_avatar_decoration_url(author):
        return True
    if isinstance(author, dict) and get_collectible_nameplate(author):
        return True
    if isinstance(author, dict) and get_display_name_style_metadata(author):
        return True
    if isinstance(author, dict):
        clan = author.get("clan")
        primary_guild = author.get("primary_guild")
        if isinstance(clan, dict) and build_clan_badge_url(clan):
            return True
        if isinstance(primary_guild, dict) and build_clan_badge_url(primary_guild):
            return True

    attachments = message.get("attachments")
    if isinstance(attachments, list) and attachments:
        return True

    embeds = message.get("embeds")
    if isinstance(embeds, list):
        for embed in embeds:
            if not isinstance(embed, dict):
                continue
            for field_name in ["thumbnail", "image", "video"]:
                media = embed.get(field_name)
                if isinstance(media, dict) and (media.get("url") or media.get("proxy_url")):
                    return True
            for field_name in ["author", "footer"]:
                nested = embed.get(field_name)
                if isinstance(nested, dict) and nested.get("icon_url"):
                    return True

    sticker_items = message.get("sticker_items")
    if isinstance(sticker_items, list) and sticker_items:
        return True

    if message_reaction_emojis_need_assets(message):
        return True

    if message_mentions_need_assets(message):
        return True

    referenced_message = message.get("referenced_message")
    if isinstance(referenced_message, dict) and message_payload_needs_assets(referenced_message, depth=depth + 1):
        return True

    snapshots = message.get("message_snapshots")
    if isinstance(snapshots, list):
        for snapshot in snapshots:
            if not isinstance(snapshot, dict):
                continue
            snapshot_message = snapshot.get("message")
            if isinstance(snapshot_message, dict) and message_payload_needs_assets(snapshot_message, depth=depth + 1):
                return True

    if message_reaction_users_need_assets(message):
        return True

    return False


def message_reaction_users_need_assets(message: dict[str, Any]) -> bool:
    export_metadata = message.get("_export")
    if not isinstance(export_metadata, dict):
        return False
    reaction_users = export_metadata.get("reaction_users")
    if not isinstance(reaction_users, list):
        return False

    for reaction_entry in reaction_users:
        if not isinstance(reaction_entry, dict):
            continue
        users = reaction_entry.get("users")
        if not isinstance(users, list):
            continue
        for user in users:
            if not isinstance(user, dict):
                continue
            if build_avatar_url(user) or build_user_banner_url(user) or build_avatar_decoration_url(user):
                return True
            if get_collectible_nameplate(user):
                return True
            if get_display_name_style_metadata(user):
                return True
            clan = user.get("clan")
            primary_guild = user.get("primary_guild")
            if isinstance(clan, dict) and build_clan_badge_url(clan):
                return True
            if isinstance(primary_guild, dict) and build_clan_badge_url(primary_guild):
                return True

    return False


def message_mentions_need_assets(message: dict[str, Any]) -> bool:
    mentions = message.get("mentions")
    if not isinstance(mentions, list):
        return False

    for mention in mentions:
        if not isinstance(mention, dict):
            continue
        if build_avatar_url(mention) or build_user_banner_url(mention) or build_avatar_decoration_url(mention):
            return True
        if get_collectible_nameplate(mention):
            return True
        if get_display_name_style_metadata(mention):
            return True
        clan = mention.get("clan")
        primary_guild = mention.get("primary_guild")
        if isinstance(clan, dict) and build_clan_badge_url(clan):
            return True
        if isinstance(primary_guild, dict) and build_clan_badge_url(primary_guild):
            return True

    return False


def message_reaction_emojis_need_assets(message: dict[str, Any]) -> bool:
    reactions = message.get("reactions")
    if not isinstance(reactions, list):
        return False

    for reaction in reactions:
        if not isinstance(reaction, dict):
            continue
        emoji = reaction.get("emoji")
        if isinstance(emoji, dict) and build_emoji_asset_url(emoji):
            return True

    return False


def message_has_reaction_user_asset_refs(message: dict[str, Any]) -> bool:
    export_metadata = message.get("_export")
    if not isinstance(export_metadata, dict):
        return False
    assets = export_metadata.get("assets")
    if not isinstance(assets, dict):
        return False
    reaction_users = assets.get("reaction_users")
    if not isinstance(reaction_users, list) or not reaction_users:
        return False

    reaction_users_by_index: dict[int, list[dict[str, Any]]] = {}
    for reaction_entry in reaction_users:
        if not isinstance(reaction_entry, dict):
            continue
        reaction_index = reaction_entry.get("reaction_index")
        users = reaction_entry.get("users")
        if isinstance(reaction_index, int) and isinstance(users, list):
            reaction_users_by_index[reaction_index] = [user for user in users if isinstance(user, dict)]

    source_export = message.get("_export") if isinstance(message.get("_export"), dict) else None
    source_reactions = source_export.get("reaction_users") if isinstance(source_export, dict) else None
    if not isinstance(source_reactions, list):
        return True

    for reaction_index, reaction_entry in enumerate(source_reactions):
        if not isinstance(reaction_entry, dict):
            continue
        users = reaction_entry.get("users")
        if not isinstance(users, list):
            continue
        refs_for_reaction = reaction_users_by_index.get(reaction_index, [])
        for user in users:
            if not isinstance(user, dict):
                continue
            user_id = user.get("id")
            matching_ref = next((ref for ref in refs_for_reaction if ref.get("user_id") == user_id), None)
            if get_collectible_nameplate(user) and (not isinstance(matching_ref, dict) or not isinstance(matching_ref.get("nameplate"), dict)):
                return False
            if get_display_name_style_metadata(user) and (not isinstance(matching_ref, dict) or not isinstance(matching_ref.get("display_name_style"), dict)):
                return False

    return True


def message_has_mention_asset_refs(message: dict[str, Any]) -> bool:
    export_metadata = message.get("_export")
    if not isinstance(export_metadata, dict):
        return False
    assets = export_metadata.get("assets")
    if not isinstance(assets, dict):
        return False
    mentions = assets.get("mentions")
    if not isinstance(mentions, list) or not mentions:
        return False

    mention_refs_by_index: dict[int, dict[str, Any]] = {}
    for mention_ref in mentions:
        if not isinstance(mention_ref, dict):
            continue
        mention_index = mention_ref.get("mention_index")
        if isinstance(mention_index, int):
            mention_refs_by_index[mention_index] = mention_ref

    source_mentions = message.get("mentions")
    if not isinstance(source_mentions, list):
        return True

    for mention_index, mention in enumerate(source_mentions):
        if not isinstance(mention, dict):
            continue
        mention_ref = mention_refs_by_index.get(mention_index)
        if get_collectible_nameplate(mention) and (not isinstance(mention_ref, dict) or not isinstance(mention_ref.get("nameplate"), dict)):
            return False
        if get_display_name_style_metadata(mention) and (not isinstance(mention_ref, dict) or not isinstance(mention_ref.get("display_name_style"), dict)):
            return False

    return True


def message_has_author_asset_refs(message: dict[str, Any]) -> bool:
    author = message.get("author")
    if not isinstance(author, dict):
        return True

    requires_nameplate = get_collectible_nameplate(author) is not None
    requires_display_name_style = get_display_name_style_metadata(author) is not None

    if not requires_nameplate and not requires_display_name_style:
        return True

    export_metadata = message.get("_export")
    if not isinstance(export_metadata, dict):
        return False
    assets = export_metadata.get("assets")
    if not isinstance(assets, dict):
        return False
    if requires_nameplate and not isinstance(assets.get("author_nameplate"), dict):
        return False
    if requires_display_name_style and not isinstance(assets.get("author_display_name_style"), dict):
        return False
    return True


def message_has_reaction_emoji_asset_refs(message: dict[str, Any]) -> bool:
    export_metadata = message.get("_export")
    if not isinstance(export_metadata, dict):
        return False
    assets = export_metadata.get("assets")
    if not isinstance(assets, dict):
        return False
    reaction_emojis = assets.get("reaction_emojis")
    return isinstance(reaction_emojis, list) and bool(reaction_emojis)


def message_has_stale_reaction_emoji_asset_refs(message: dict[str, Any]) -> bool:
    if not message_has_reaction_emoji_asset_refs(message):
        return False
    return not message_reaction_emojis_need_assets(message)


def enrich_message_asset_payload(
    asset_store: AssetStore,
    message: dict[str, Any],
    guild_stickers_by_id: dict[str, dict[str, Any]],
    *,
    message_id: str,
    context_path: str,
    depth: int = 0,
) -> tuple[dict[str, Any], int, bool]:
    if depth > 4:
        return {}, 0, False

    asset_refs: dict[str, Any] = {}
    asset_ref_count = 0
    attempted_asset_enrichment = False
    context_slug = asset_context_slug(context_path)

    author = message.get("author") if isinstance(message.get("author"), dict) else None
    if isinstance(author, dict):
        avatar_url = build_avatar_url(author)
        if avatar_url:
            attempted_asset_enrichment = True
        avatar_record = asset_store.fetch(
            url=avatar_url,
            category="user-avatars",
            suggested_name=f"{author.get('id', 'user')}.png",
            source_kind="message_author_avatar",
            source_ref={"message_id": message_id, "context_path": context_path, "user_id": author.get("id")},
        )
        if avatar_record is not None:
            asset_refs["author_avatar"] = {"asset_id": avatar_record["id"], "path": avatar_record.get("path")}
            asset_ref_count += 1

        banner_url = build_user_banner_url(author)
        if banner_url:
            attempted_asset_enrichment = True
        banner_record = asset_store.fetch(
            url=banner_url,
            category="user-banners",
            suggested_name=f"{author.get('id', 'user')}.png",
            source_kind="message_author_banner",
            source_ref={"message_id": message_id, "context_path": context_path, "user_id": author.get("id")},
        )
        if banner_record is not None:
            asset_refs["author_banner"] = {"asset_id": banner_record["id"], "path": banner_record.get("path")}
            asset_ref_count += 1

        decoration_url = build_avatar_decoration_url(author)
        if decoration_url:
            attempted_asset_enrichment = True
        decoration_record = asset_store.fetch(
            url=decoration_url,
            category="avatar-decorations",
            suggested_name=f"{author.get('id', 'user')}.png",
            source_kind="message_author_avatar_decoration",
            source_ref={"message_id": message_id, "context_path": context_path, "user_id": author.get("id")},
        )
        if decoration_record is not None:
            asset_refs["author_avatar_decoration"] = {"asset_id": decoration_record["id"], "path": decoration_record.get("path")}
            asset_ref_count += 1

        clan_badges: list[dict[str, Any]] = []
        for badge_field in ["clan", "primary_guild"]:
            badge_owner = author.get(badge_field)
            if not isinstance(badge_owner, dict):
                continue
            badge_url = build_clan_badge_url(badge_owner)
            if badge_url:
                attempted_asset_enrichment = True
            badge_record = asset_store.fetch(
                url=badge_url,
                category="clan-badges",
                suggested_name=f"{author.get('id', 'user')}-{badge_field}.png",
                source_kind=f"message_author_{badge_field}_badge",
                source_ref={"message_id": message_id, "context_path": context_path, "user_id": author.get("id")},
            )
            if badge_record is not None:
                clan_badges.append({
                    "field": badge_field,
                    "asset_id": badge_record["id"],
                    "path": badge_record.get("path"),
                    "status": badge_record.get("status"),
                })
                asset_ref_count += 1
        if clan_badges:
            asset_refs["author_clan_badges"] = clan_badges

        nameplate_ref = get_collectible_nameplate(author)
        if nameplate_ref is not None:
            attempted_asset_enrichment = True
            asset_refs["author_nameplate"] = nameplate_ref
            asset_ref_count += 1

        display_name_style_ref = get_display_name_style_metadata(author)
        if display_name_style_ref is not None:
            attempted_asset_enrichment = True
            asset_refs["author_display_name_style"] = display_name_style_ref
            asset_ref_count += 1

    attachment_refs: list[dict[str, Any]] = []
    for attachment in message.get("attachments", []) if isinstance(message.get("attachments"), list) else []:
        if not isinstance(attachment, dict):
            continue
        attempted_asset_enrichment = True
        record = asset_store.fetch(
            url=str(attachment.get("url") or "") or None,
            fallback_url=str(attachment.get("proxy_url") or "") or None,
            category="message-attachments",
            suggested_name=str(attachment.get("filename") or attachment.get("id") or f"{context_slug}-attachment.bin"),
            source_kind="message_attachment",
            source_ref={
                "message_id": message_id,
                "context_path": context_path,
                "attachment_id": attachment.get("id"),
            },
        )
        if record is not None:
            attachment_refs.append({
                "attachment_id": attachment.get("id"),
                "asset_id": record["id"],
                "path": record.get("path"),
                "status": record.get("status"),
            })
            asset_ref_count += 1
    if attachment_refs:
        asset_refs["attachments"] = attachment_refs

    embed_refs: list[dict[str, Any]] = []
    for embed_index, embed in enumerate(message.get("embeds", []) if isinstance(message.get("embeds"), list) else []):
        if not isinstance(embed, dict):
            continue
        current_refs: list[dict[str, Any]] = []
        for field_name in ["thumbnail", "image", "video"]:
            media = embed.get(field_name)
            if not isinstance(media, dict):
                continue
            media_url = str(media.get("url") or "") or None
            fallback_url = str(media.get("proxy_url") or "") or None
            if media_url or fallback_url:
                attempted_asset_enrichment = True
            record = asset_store.fetch(
                url=media_url,
                fallback_url=fallback_url,
                category="embed-media",
                suggested_name=(
                    f"message-{message_id}-{context_slug}-embed-{embed_index}-{field_name}"
                    f"{Path(parse.urlparse(str(media_url or fallback_url or '')).path).suffix or ''}"
                ),
                source_kind=f"embed_{field_name}",
                source_ref={"message_id": message_id, "context_path": context_path, "embed_index": embed_index, "field": field_name},
            )
            if record is not None:
                current_refs.append({
                    "field": field_name,
                    "asset_id": record["id"],
                    "path": record.get("path"),
                    "status": record.get("status"),
                })
                asset_ref_count += 1

        for field_name in ["author", "footer"]:
            nested = embed.get(field_name)
            if not isinstance(nested, dict):
                continue
            icon_url = str(nested.get("icon_url") or "") or None
            if not icon_url:
                continue
            attempted_asset_enrichment = True
            record = asset_store.fetch(
                url=icon_url,
                category="embed-media",
                suggested_name=f"message-{message_id}-{context_slug}-embed-{embed_index}-{field_name}-icon{Path(parse.urlparse(icon_url).path).suffix}",
                source_kind=f"embed_{field_name}_icon",
                source_ref={"message_id": message_id, "context_path": context_path, "embed_index": embed_index, "field": field_name},
            )
            if record is not None:
                current_refs.append({
                    "field": f"{field_name}.icon_url",
                    "asset_id": record["id"],
                    "path": record.get("path"),
                    "status": record.get("status"),
                })
                asset_ref_count += 1

        if current_refs:
            embed_refs.append({"embed_index": embed_index, "assets": current_refs})
    if embed_refs:
        asset_refs["embeds"] = embed_refs

    sticker_refs: list[dict[str, Any]] = []
    for sticker_item in message.get("sticker_items", []) if isinstance(message.get("sticker_items"), list) else []:
        if not isinstance(sticker_item, dict):
            continue
        sticker = guild_stickers_by_id.get(str(sticker_item.get("id"))) or sticker_item
        sticker_url = build_sticker_asset_url(sticker)
        if sticker_url:
            attempted_asset_enrichment = True
        record = asset_store.fetch(
            url=sticker_url,
            category="stickers",
            suggested_name=f"{sticker_item.get('id', 'sticker')}{Path(parse.urlparse(str(sticker_url or '')).path).suffix}",
            source_kind="message_sticker",
            source_ref={"message_id": message_id, "context_path": context_path, "sticker_id": sticker_item.get("id")},
        )
        if record is not None:
            sticker_refs.append({
                "sticker_id": sticker_item.get("id"),
                "asset_id": record["id"],
                "path": record.get("path"),
                "status": record.get("status"),
            })
            asset_ref_count += 1
    if sticker_refs:
        asset_refs["stickers"] = sticker_refs

    reaction_emoji_refs: list[dict[str, Any]] = []
    for reaction_index, reaction in enumerate(message.get("reactions", []) if isinstance(message.get("reactions"), list) else []):
        if not isinstance(reaction, dict):
            continue
        emoji = reaction.get("emoji")
        if not isinstance(emoji, dict):
            continue
        emoji_url = build_emoji_asset_url(emoji)
        if emoji_url:
            attempted_asset_enrichment = True
        record = asset_store.fetch(
            url=emoji_url,
            category="reaction-emojis",
            suggested_name=(
                f"message-{message_id}-{context_slug}-reaction-{reaction_index}-emoji-"
                f"{emoji.get('id') or slugify(str(emoji.get('name') or 'emoji'), 'emoji')}"
                f"{Path(parse.urlparse(str(emoji_url or '')).path).suffix}"
            ),
            source_kind="reaction_emoji",
            source_ref={
                "message_id": message_id,
                "context_path": context_path,
                "reaction_index": reaction_index,
                "emoji_id": emoji.get("id"),
                "emoji_name": emoji.get("name"),
            },
        )
        if record is not None:
            reaction_emoji_refs.append({
                "reaction_index": reaction_index,
                "emoji": emoji,
                "asset_id": record["id"],
                "path": record.get("path"),
                "status": record.get("status"),
            })
            asset_ref_count += 1
    if reaction_emoji_refs:
        asset_refs["reaction_emojis"] = reaction_emoji_refs

    reaction_user_refs: list[dict[str, Any]] = []
    export_metadata = message.get("_export") if isinstance(message.get("_export"), dict) else None
    reaction_users_payload = export_metadata.get("reaction_users") if isinstance(export_metadata, dict) else None
    for reaction_index, reaction_entry in enumerate(reaction_users_payload if isinstance(reaction_users_payload, list) else []):
        if not isinstance(reaction_entry, dict):
            continue
        users = reaction_entry.get("users")
        if not isinstance(users, list):
            continue

        current_reaction_refs: list[dict[str, Any]] = []
        for user_index, user in enumerate(users):
            if not isinstance(user, dict):
                continue

            user_id = str(user.get("id") or user_index)
            current_user_refs: dict[str, Any] = {
                "user_id": user.get("id"),
                "username": user.get("username"),
            }

            avatar_url = build_avatar_url(user)
            if avatar_url:
                attempted_asset_enrichment = True
            avatar_record = asset_store.fetch(
                url=avatar_url,
                category="reaction-user-avatars",
                suggested_name=f"{user_id}.png",
                source_kind="reaction_user_avatar",
                source_ref={
                    "message_id": message_id,
                    "context_path": context_path,
                    "reaction_index": reaction_index,
                    "user_id": user.get("id"),
                },
            )
            if avatar_record is not None:
                current_user_refs["avatar"] = {"asset_id": avatar_record["id"], "path": avatar_record.get("path")}
                asset_ref_count += 1

            banner_url = build_user_banner_url(user)
            if banner_url:
                attempted_asset_enrichment = True
            banner_record = asset_store.fetch(
                url=banner_url,
                category="reaction-user-banners",
                suggested_name=f"{user_id}.png",
                source_kind="reaction_user_banner",
                source_ref={
                    "message_id": message_id,
                    "context_path": context_path,
                    "reaction_index": reaction_index,
                    "user_id": user.get("id"),
                },
            )
            if banner_record is not None:
                current_user_refs["banner"] = {"asset_id": banner_record["id"], "path": banner_record.get("path")}
                asset_ref_count += 1

            decoration_url = build_avatar_decoration_url(user)
            if decoration_url:
                attempted_asset_enrichment = True
            decoration_record = asset_store.fetch(
                url=decoration_url,
                category="reaction-user-avatar-decorations",
                suggested_name=f"{user_id}.png",
                source_kind="reaction_user_avatar_decoration",
                source_ref={
                    "message_id": message_id,
                    "context_path": context_path,
                    "reaction_index": reaction_index,
                    "user_id": user.get("id"),
                },
            )
            if decoration_record is not None:
                current_user_refs["avatar_decoration"] = {"asset_id": decoration_record["id"], "path": decoration_record.get("path")}
                asset_ref_count += 1

            reaction_user_clan_badges: list[dict[str, Any]] = []
            for badge_field in ["clan", "primary_guild"]:
                badge_owner = user.get(badge_field)
                if not isinstance(badge_owner, dict):
                    continue
                badge_url = build_clan_badge_url(badge_owner)
                if badge_url:
                    attempted_asset_enrichment = True
                badge_record = asset_store.fetch(
                    url=badge_url,
                    category="reaction-user-clan-badges",
                    suggested_name=f"{user_id}-{badge_field}.png",
                    source_kind=f"reaction_user_{badge_field}_badge",
                    source_ref={
                        "message_id": message_id,
                        "context_path": context_path,
                        "reaction_index": reaction_index,
                        "user_id": user.get("id"),
                    },
                )
                if badge_record is not None:
                    reaction_user_clan_badges.append({
                        "field": badge_field,
                        "asset_id": badge_record["id"],
                        "path": badge_record.get("path"),
                        "status": badge_record.get("status"),
                    })
                    asset_ref_count += 1
            if reaction_user_clan_badges:
                current_user_refs["clan_badges"] = reaction_user_clan_badges

            nameplate_ref = get_collectible_nameplate(user)
            if nameplate_ref is not None:
                attempted_asset_enrichment = True
                current_user_refs["nameplate"] = nameplate_ref
                asset_ref_count += 1

            display_name_style_ref = get_display_name_style_metadata(user)
            if display_name_style_ref is not None:
                attempted_asset_enrichment = True
                current_user_refs["display_name_style"] = display_name_style_ref
                asset_ref_count += 1

            if len(current_user_refs) > 2:
                current_reaction_refs.append(current_user_refs)

        if current_reaction_refs:
            reaction_user_refs.append({
                "reaction_index": reaction_index,
                "emoji": reaction_entry.get("emoji"),
                "users": current_reaction_refs,
            })

    if reaction_user_refs:
        asset_refs["reaction_users"] = reaction_user_refs

    mention_refs: list[dict[str, Any]] = []
    for mention_index, mention in enumerate(message.get("mentions", []) if isinstance(message.get("mentions"), list) else []):
        if not isinstance(mention, dict):
            continue

        mention_id = str(mention.get("id") or mention_index)
        current_mention_refs: dict[str, Any] = {
            "mention_index": mention_index,
            "user_id": mention.get("id"),
            "username": mention.get("username"),
        }

        avatar_url = build_avatar_url(mention)
        if avatar_url:
            attempted_asset_enrichment = True
        avatar_record = asset_store.fetch(
            url=avatar_url,
            category="mentioned-user-avatars",
            suggested_name=f"{mention_id}.png",
            source_kind="mentioned_user_avatar",
            source_ref={
                "message_id": message_id,
                "context_path": context_path,
                "mention_index": mention_index,
                "user_id": mention.get("id"),
            },
        )
        if avatar_record is not None:
            current_mention_refs["avatar"] = {"asset_id": avatar_record["id"], "path": avatar_record.get("path")}
            asset_ref_count += 1

        banner_url = build_user_banner_url(mention)
        if banner_url:
            attempted_asset_enrichment = True
        banner_record = asset_store.fetch(
            url=banner_url,
            category="mentioned-user-banners",
            suggested_name=f"{mention_id}.png",
            source_kind="mentioned_user_banner",
            source_ref={
                "message_id": message_id,
                "context_path": context_path,
                "mention_index": mention_index,
                "user_id": mention.get("id"),
            },
        )
        if banner_record is not None:
            current_mention_refs["banner"] = {"asset_id": banner_record["id"], "path": banner_record.get("path")}
            asset_ref_count += 1

        decoration_url = build_avatar_decoration_url(mention)
        if decoration_url:
            attempted_asset_enrichment = True
        decoration_record = asset_store.fetch(
            url=decoration_url,
            category="mentioned-user-avatar-decorations",
            suggested_name=f"{mention_id}.png",
            source_kind="mentioned_user_avatar_decoration",
            source_ref={
                "message_id": message_id,
                "context_path": context_path,
                "mention_index": mention_index,
                "user_id": mention.get("id"),
            },
        )
        if decoration_record is not None:
            current_mention_refs["avatar_decoration"] = {"asset_id": decoration_record["id"], "path": decoration_record.get("path")}
            asset_ref_count += 1

        mention_clan_badges: list[dict[str, Any]] = []
        for badge_field in ["clan", "primary_guild"]:
            badge_owner = mention.get(badge_field)
            if not isinstance(badge_owner, dict):
                continue
            badge_url = build_clan_badge_url(badge_owner)
            if badge_url:
                attempted_asset_enrichment = True
            badge_record = asset_store.fetch(
                url=badge_url,
                category="mentioned-user-clan-badges",
                suggested_name=f"{mention_id}-{badge_field}.png",
                source_kind=f"mentioned_user_{badge_field}_badge",
                source_ref={
                    "message_id": message_id,
                    "context_path": context_path,
                    "mention_index": mention_index,
                    "user_id": mention.get("id"),
                },
            )
            if badge_record is not None:
                mention_clan_badges.append({
                    "field": badge_field,
                    "asset_id": badge_record["id"],
                    "path": badge_record.get("path"),
                    "status": badge_record.get("status"),
                })
                asset_ref_count += 1
        if mention_clan_badges:
            current_mention_refs["clan_badges"] = mention_clan_badges

        nameplate_ref = get_collectible_nameplate(mention)
        if nameplate_ref is not None:
            attempted_asset_enrichment = True
            current_mention_refs["nameplate"] = nameplate_ref
            asset_ref_count += 1

        display_name_style_ref = get_display_name_style_metadata(mention)
        if display_name_style_ref is not None:
            attempted_asset_enrichment = True
            current_mention_refs["display_name_style"] = display_name_style_ref
            asset_ref_count += 1

        if len(current_mention_refs) > 3:
            mention_refs.append(current_mention_refs)

    if mention_refs:
        asset_refs["mentions"] = mention_refs

    referenced_message = message.get("referenced_message")
    if isinstance(referenced_message, dict):
        nested_refs, nested_count, nested_attempted = enrich_message_asset_payload(
            asset_store,
            referenced_message,
            guild_stickers_by_id,
            message_id=message_id,
            context_path=f"{context_path}.referenced_message",
            depth=depth + 1,
        )
        if nested_refs:
            asset_refs["referenced_message"] = nested_refs
        asset_ref_count += nested_count
        attempted_asset_enrichment = attempted_asset_enrichment or nested_attempted

    snapshot_refs: list[dict[str, Any]] = []
    for snapshot_index, snapshot in enumerate(message.get("message_snapshots", []) if isinstance(message.get("message_snapshots"), list) else []):
        if not isinstance(snapshot, dict):
            continue
        snapshot_message = snapshot.get("message")
        if not isinstance(snapshot_message, dict):
            continue
        nested_refs, nested_count, nested_attempted = enrich_message_asset_payload(
            asset_store,
            snapshot_message,
            guild_stickers_by_id,
            message_id=message_id,
            context_path=f"{context_path}.message_snapshots[{snapshot_index}]",
            depth=depth + 1,
        )
        if nested_refs:
            snapshot_refs.append({"snapshot_index": snapshot_index, "assets": nested_refs})
        asset_ref_count += nested_count
        attempted_asset_enrichment = attempted_asset_enrichment or nested_attempted
    if snapshot_refs:
        asset_refs["message_snapshots"] = snapshot_refs

    return asset_refs, asset_ref_count, attempted_asset_enrichment


def enrich_messages_with_reaction_users(client: DiscordApiClient, messages: list[dict[str, Any]]) -> int:
    return enrich_messages_with_reaction_users_checkpointed(client, messages)


def enrich_messages_with_reaction_users_checkpointed(
    client: DiscordApiClient,
    messages: list[dict[str, Any]],
    checkpoint: Callable[[], None] | None = None,
    progress: Callable[[int, int, int], None] | None = None,
    progress_interval: int = 50,
) -> int:
    reaction_user_count = 0
    total_messages = len(messages)
    for message_index, message in enumerate(messages, start=1):
        reactions = message.get("reactions")
        if not isinstance(reactions, list) or not reactions:
            continue

        export_metadata = message.get("_export")
        if isinstance(export_metadata, dict):
            if export_metadata.get("reaction_enrichment_complete") is True:
                continue
            existing_reactions = export_metadata.get("reaction_users")
            if isinstance(existing_reactions, list):
                continue

        exported_reactions: list[dict[str, Any]] = []
        channel_id = str(message.get("channel_id", ""))
        message_id = str(message.get("id", ""))

        for reaction in reactions:
            emoji = reaction.get("emoji", {}) if isinstance(reaction, dict) else {}
            if not isinstance(emoji, dict):
                continue

            entry: dict[str, Any] = {
                "emoji": emoji,
            }
            try:
                users = fetch_reaction_users(client, channel_id=channel_id, message_id=message_id, emoji=emoji)
                entry["users"] = users
                reaction_user_count += len(users)
            except Exception as exc:
                entry["error"] = str(exc)
            exported_reactions.append(entry)

        if exported_reactions:
            export_metadata = cast(dict[str, Any], message.setdefault("_export", {}))
            export_metadata["reaction_users"] = exported_reactions
            export_metadata["reaction_enrichment_complete"] = True
            if checkpoint is not None:
                checkpoint()
            if progress is not None and (message_index == 1 or message_index == total_messages or message_index % progress_interval == 0):
                progress(message_index, total_messages, reaction_user_count)

    return reaction_user_count


def enrich_messages_with_assets(
    asset_store: AssetStore,
    messages: list[dict[str, Any]],
    guild_stickers_by_id: dict[str, dict[str, Any]],
) -> int:
    return enrich_messages_with_assets_checkpointed(asset_store, messages, guild_stickers_by_id)


def enrich_messages_with_assets_checkpointed(
    asset_store: AssetStore,
    messages: list[dict[str, Any]],
    guild_stickers_by_id: dict[str, dict[str, Any]],
    checkpoint: Callable[[], None] | None = None,
    progress: Callable[[int, int, int], None] | None = None,
    progress_interval: int = 50,
) -> int:
    asset_ref_count = 0

    total_messages = len(messages)
    for message_index, message in enumerate(messages, start=1):
        export_metadata = cast(dict[str, Any], message.setdefault("_export", {}))
        asset_refs, current_asset_ref_count, attempted_asset_enrichment = enrich_message_asset_payload(
            asset_store,
            message,
            guild_stickers_by_id,
            message_id=str(message.get("id") or message_index),
            context_path="message",
        )
        asset_ref_count += current_asset_ref_count

        if asset_refs:
            export_metadata["assets"] = asset_refs
        if attempted_asset_enrichment:
            export_metadata["asset_enrichment_complete"] = True
        if asset_refs or attempted_asset_enrichment:
            if checkpoint is not None:
                checkpoint()
            if progress is not None and (message_index == 1 or message_index == total_messages or message_index % progress_interval == 0):
                progress(message_index, total_messages, asset_ref_count)

    return asset_ref_count


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)

    temp_path = path.with_name(f".{path.name}.{os.getpid()}.{time.time_ns()}.tmp")
    payload_text = json.dumps(payload, indent=2, ensure_ascii=True)

    try:
        with temp_path.open("w", encoding="utf-8", newline="\n") as handle:
            handle.write(payload_text)
            handle.flush()
            os.fsync(handle.fileno())
        replace_with_retry(temp_path, path)
    except OSError:
        try:
            temp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def quarantine_corrupt_json(path: Path, exc: Exception, *, logger: Logger | None = None) -> None:
    timestamp = utc_now().strftime("%Y%m%dT%H%M%SZ")
    quarantine_path = path.with_name(f"{path.stem}.corrupt-{timestamp}{path.suffix}")

    try:
        replace_with_retry(path, quarantine_path)
        if logger is not None:
            logger.warning(
                f"Quarantined unreadable JSON cache {path} -> {quarantine_path}: {exc}"
            )
    except OSError as rename_exc:
        if logger is not None:
            logger.warning(
                f"Unreadable JSON cache at {path} could not be quarantined: {exc}; rename failed: {rename_exc}"
            )


def read_json(path: Path, *, logger: Logger | None = None) -> Any:
    if not path.exists():
        return None

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        quarantine_corrupt_json(path, exc, logger=logger)
        return None


def build_output_dir(output_root: Path, guild_name: str, guild_id: str) -> Path:
    stamp = utc_now().strftime("%Y%m%dT%H%M%SZ")
    slug = slugify(guild_name, guild_id)
    return output_root / f"discord-server-{slug}-{guild_id}-{stamp}"


def container_file_name(channel: dict[str, Any]) -> str:
    channel_id = str(channel.get("id", "unknown"))
    channel_name = slugify(str(channel.get("name", "")), channel_id)
    return f"{channel_id}-{channel_name}.json"


def count_asset_refs(value: Any) -> int:
    if isinstance(value, dict):
        count = 1 if "asset_id" in value else 0
        return count + sum(count_asset_refs(item) for item in value.values())
    if isinstance(value, list):
        return sum(count_asset_refs(item) for item in value)
    return 0


def count_reaction_users_in_messages(messages: list[dict[str, Any]]) -> int:
    total = 0
    for message in messages:
        export_metadata = message.get("_export")
        if not isinstance(export_metadata, dict):
            continue
        reactions = export_metadata.get("reaction_users")
        if not isinstance(reactions, list):
            continue
        for reaction in reactions:
            if not isinstance(reaction, dict):
                continue
            users = reaction.get("users")
            if isinstance(users, list):
                total += len(users)
    return total


def build_container_summary(payload: dict[str, Any], *, file_name: str) -> dict[str, Any]:
    messages = payload.get("messages")
    message_list = messages if isinstance(messages, list) else []
    errors = payload.get("errors")
    error_list = errors if isinstance(errors, list) else []
    channel = payload.get("channel")
    channel_dict = channel if isinstance(channel, dict) else {}
    return {
        "id": channel_dict.get("id"),
        "name": channel_dict.get("name"),
        "type_name": channel_dict.get("type_name"),
        "scope": payload.get("container_scope"),
        "parent_id": channel_dict.get("parent_id"),
        "message_count": int(payload.get("message_count", 0) or 0),
        "reaction_user_count": count_reaction_users_in_messages(message_list),
        "asset_ref_count": count_asset_refs([message.get("_export", {}) for message in message_list]),
        "error_count": len(error_list),
        "file_name": file_name,
    }


def build_failure_entry(payload: dict[str, Any]) -> dict[str, Any] | None:
    errors = payload.get("errors")
    if not isinstance(errors, list) or not errors:
        return None
    channel = payload.get("channel")
    channel_dict = channel if isinstance(channel, dict) else {}
    return {
        "container_id": channel_dict.get("id"),
        "container_name": channel_dict.get("name"),
        "scope": payload.get("container_scope"),
        "error": str(errors[0]),
    }


def payload_has_reaction_user_enrichment(payload: dict[str, Any]) -> bool:
    messages = payload.get("messages")
    if not isinstance(messages, list):
        return True

    for message in messages:
        if not isinstance(message, dict):
            continue
        reactions = message.get("reactions")
        if not isinstance(reactions, list) or not reactions:
            continue
        export_metadata = message.get("_export")
        if not isinstance(export_metadata, dict):
            return False
        reaction_users = export_metadata.get("reaction_users")
        if not isinstance(reaction_users, list):
            return False
    return True


def payload_has_asset_enrichment(payload: dict[str, Any]) -> bool:
    messages = payload.get("messages")
    if not isinstance(messages, list):
        return True

    for message in messages:
        if not isinstance(message, dict):
            continue
        needs_assets = message_payload_needs_assets(message)

        if not needs_assets:
            continue

        export_metadata = message.get("_export")
        if not isinstance(export_metadata, dict):
            return False
        if export_metadata.get("asset_enrichment_complete") is True and message_has_stale_reaction_emoji_asset_refs(message):
            return False
        if export_metadata.get("asset_enrichment_complete") is True and message_reaction_emojis_need_assets(message) and not message_has_reaction_emoji_asset_refs(message):
            return False
        if export_metadata.get("asset_enrichment_complete") is True and not message_has_author_asset_refs(message):
            return False
        if export_metadata.get("asset_enrichment_complete") is True and message_reaction_users_need_assets(message) and not message_has_reaction_user_asset_refs(message):
            return False
        if export_metadata.get("asset_enrichment_complete") is True and message_mentions_need_assets(message) and not message_has_mention_asset_refs(message):
            return False
        if export_metadata.get("asset_enrichment_complete") is True and not message_payload_needs_assets(message):
            continue
        assets = export_metadata.get("assets")
        if not isinstance(assets, dict) or not assets:
            return False

    return True


def payload_satisfies_options(payload: dict[str, Any], *, options: ExportOptions) -> bool:
    if options.include_reaction_users and not payload_has_reaction_user_enrichment(payload):
        return False
    if options.download_assets and not payload_has_asset_enrichment(payload):
        return False
    return True


def payload_satisfies_message_phase(payload: dict[str, Any], *, options: ExportOptions) -> bool:
    if options.include_reaction_users and not payload_has_reaction_user_enrichment(payload):
        return False
    return True


def payload_satisfies_asset_phase(payload: dict[str, Any], *, options: ExportOptions) -> bool:
    if not options.download_assets:
        return True
    return payload_has_asset_enrichment(payload)


def build_manifest(
    *,
    exported_at: str,
    bot_user: dict[str, Any],
    guild: dict[str, Any],
    options: ExportOptions,
    top_level_channels: list[dict[str, Any]],
    active_threads: list[dict[str, Any]],
    archived_threads: list[dict[str, Any]],
    archived_thread_errors: list[dict[str, Any]],
    optional_resource_errors: list[dict[str, Any]],
    container_summaries: list[dict[str, Any]],
    failures: list[dict[str, Any]],
    asset_store: AssetStore | None,
    members: Any,
    roles: Any,
    guild_emojis: list[dict[str, Any]],
    guild_stickers: list[dict[str, Any]],
    scheduled_events: Any,
    welcome_screen: Any,
    soundboard_sounds: Any,
    guild_widget: Any,
    widget_settings: Any,
    vanity_url: Any,
    guild_asset_refs: list[dict[str, Any]],
) -> dict[str, Any]:
    downloaded_asset_count = 0
    if asset_store is not None:
        downloaded_asset_count = sum(1 for record in asset_store.manifest() if record.get("status") == "downloaded")

    container_asset_ref_count = sum(int(summary.get("asset_ref_count", 0) or 0) for summary in container_summaries)
    guild_asset_ref_count = len(guild_asset_refs)

    widget_member_count = 0
    widget_channel_count = 0
    widget_presence_count = 0
    if isinstance(guild_widget, dict):
        widget_member_count = len(guild_widget.get("members", [])) if isinstance(guild_widget.get("members"), list) else 0
        widget_channel_count = len(guild_widget.get("channels", [])) if isinstance(guild_widget.get("channels"), list) else 0
        widget_presence_count = int(guild_widget.get("presence_count", 0) or 0)

    widget_image_style_count = sum(1 for ref in guild_asset_refs if ref.get("source_kind") == "guild_widget_image")
    guild_resource_summary = build_guild_resource_summary(
        optional_resource_errors=optional_resource_errors,
        welcome_screen=welcome_screen,
        soundboard_sounds=soundboard_sounds,
        vanity_url=vanity_url,
        guild_widget=guild_widget,
        widget_settings=widget_settings,
        widget_member_count=widget_member_count,
        widget_image_style_count=widget_image_style_count,
    )

    return {
        "exported_at": exported_at,
        "bot_user": {
            "id": bot_user.get("id"),
            "username": bot_user.get("username"),
            "discriminator": bot_user.get("discriminator"),
            "bot": bot_user.get("bot"),
        },
        "guild": {
            "id": guild.get("id"),
            "name": guild.get("name"),
            "description": guild.get("description"),
            "features": guild.get("features"),
        },
        "options": {
            "metadata_only": options.metadata_only,
            "download_assets": options.download_assets,
            "include_reaction_users": options.include_reaction_users,
            "include_archived_threads": options.include_archived_threads,
            "include_private_archived_threads": options.include_private_archived_threads,
            "max_messages_per_container": options.max_messages_per_container,
            "include_channels": sorted(options.include_channels),
            "exclude_channels": sorted(options.exclude_channels),
            "exclude_channel_types": sorted(options.exclude_channel_types),
            "strict": options.strict,
            "resume": options.resume,
        },
        "counts": {
            "top_level_channel_count": len(top_level_channels),
            "active_thread_count": len(active_threads),
            "archived_thread_count": len(archived_threads),
            "exported_container_count": len(container_summaries),
            "failed_container_count": len(failures),
            "total_message_count": sum(int(summary.get("message_count", 0) or 0) for summary in container_summaries),
            "total_reaction_user_count": sum(int(summary.get("reaction_user_count", 0) or 0) for summary in container_summaries),
            "downloaded_asset_count": downloaded_asset_count,
            "container_asset_ref_count": container_asset_ref_count,
            "guild_asset_ref_count": guild_asset_ref_count,
            "total_asset_ref_count": container_asset_ref_count + guild_asset_ref_count,
            "member_count": len(members) if isinstance(members, list) else 0,
            "role_count": len(roles) if isinstance(roles, list) else 0,
            "emoji_count": len(guild_emojis),
            "sticker_count": len(guild_stickers),
            "scheduled_event_count": len(scheduled_events) if isinstance(scheduled_events, list) else 0,
            "welcome_screen_enabled": bool(isinstance(welcome_screen, dict) and welcome_screen.get("enabled")),
            "soundboard_sound_count": len(soundboard_sounds) if isinstance(soundboard_sounds, list) else 0,
            "widget_enabled": bool(guild.get("widget_enabled")),
            "widget_settings_enabled": bool(isinstance(widget_settings, dict) and widget_settings.get("enabled")),
            "widget_channel_count": widget_channel_count,
            "widget_member_count": widget_member_count,
            "widget_presence_count": widget_presence_count,
            "widget_image_style_count": widget_image_style_count,
            "vanity_url_present": bool(isinstance(vanity_url, dict) and vanity_url.get("code")),
            "vanity_url_use_count": int(vanity_url.get("uses", 0) or 0) if isinstance(vanity_url, dict) else 0,
        },
        "guild_resource_summary": guild_resource_summary,
        "archived_thread_errors": archived_thread_errors,
        "optional_resource_errors": optional_resource_errors,
        "failures": failures,
        "containers": container_summaries,
    }


def is_resume_checkpoint_dir(path: Path) -> bool:
    return path.is_dir() and (path / "manifest.json").exists() and (path / "guild.json").exists()


def find_latest_resume_dir(output_root: Path, guild_id: str) -> Path | None:
    candidates = [path for path in output_root.glob(f"discord-server-*-{guild_id}-*") if is_resume_checkpoint_dir(path)]
    if not candidates:
        return None
    return max(candidates, key=lambda path: path.stat().st_mtime)


def build_container_payload(
    *,
    channel: dict[str, Any],
    container_scope: str,
    messages: list[dict[str, Any]] | None,
    exported_at: str,
    errors: list[str],
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "exported_at": exported_at,
        "container_scope": container_scope,
        "channel": {
            "id": channel.get("id"),
            "name": channel.get("name"),
            "type": channel.get("type"),
            "type_name": channel_type_name(int(channel.get("type", -1))),
            "parent_id": channel.get("parent_id"),
            "position": channel.get("position"),
            "topic": channel.get("topic"),
            "nsfw": channel.get("nsfw"),
            "raw": channel,
        },
        "errors": errors,
    }

    if messages is not None:
        payload["message_count"] = len(messages)
        payload["oldest_message_id"] = messages[0].get("id") if messages else None
        payload["newest_message_id"] = messages[-1].get("id") if messages else None
        payload["messages"] = messages
    else:
        payload["message_count"] = 0
        payload["messages"] = None

    return payload


def format_container_log_fields(channel: dict[str, Any], container_scope: str) -> str:
    container_id = str(channel.get("id", "")).strip() or "unknown"
    container_name = str(channel.get("name", "unknown"))
    container_type = channel_type_name(int(channel.get("type", -1)))
    return f"scope={container_scope} type={container_type} id={container_id} name={ascii(container_name)}"


def determine_options(args: argparse.Namespace, env: dict[str, str], repo_root: Path) -> ExportOptions:
    token = (args.token or env.get(args.token_env, "")).strip()
    guild_id = (args.guild_id or env.get(args.guild_id_env, "") or env.get(args.fallback_guild_id_env, "")).strip()

    if not token:
        raise RuntimeError(f"Missing Discord bot token. Checked --token and env var {args.token_env}.")
    if not guild_id:
        raise RuntimeError(
            "Missing guild id. Checked --guild-id and env vars "
            f"{args.guild_id_env} / {args.fallback_guild_id_env}."
        )

    output_dir = Path(args.output_dir) if args.output_dir else None
    output_file = Path(args.output_file) if args.output_file else None
    output_root = Path(args.output_root)

    if output_dir is not None and output_file is not None:
        raise RuntimeError("Use either --output-dir or --output-file, not both.")

    if not output_root.is_absolute():
        output_root = repo_root / output_root
    if output_dir and not output_dir.is_absolute():
        output_dir = repo_root / output_dir
    if output_file and not output_file.is_absolute():
        output_file = repo_root / output_file

    return ExportOptions(
        token=token,
        guild_id=guild_id,
        output_root=output_root,
        output_dir=output_dir,
        output_file=output_file,
        include_channels=parse_repeated_text(args.include_channel),
        exclude_channels=parse_repeated_text(args.exclude_channel),
        exclude_channel_types={value.casefold() for value in (args.exclude_channel_type or [])},
        include_archived_threads=not args.exclude_archived_threads,
        include_private_archived_threads=not args.exclude_private_archived_threads,
        metadata_only=args.metadata_only,
        download_assets=not args.no_assets,
        include_reaction_users=not args.no_reaction_users,
        resume=not args.no_resume,
        max_messages_per_container=args.max_messages_per_container,
        strict=args.strict,
        log_level=resolve_log_level(args.log_level, args.verbose),
        color=resolve_color_setting(args.color, args.no_color),
        json_summary=args.json_summary,
        timeout_seconds=args.timeout_seconds,
        max_retries=args.max_retries,
    )


def resolve_log_level(log_level: str, verbose: bool) -> LogLevel:
    if verbose and log_level == "info":
        return LogLevel.DEBUG
    return LOG_LEVEL_NAMES[log_level]


def resolve_color_setting(force_color: bool, no_color: bool) -> bool:
    if force_color and no_color:
        raise RuntimeError("Use either --color or --no-color, not both.")
    if force_color:
        return True
    if no_color:
        return False
    return sys.stderr.isatty()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="export_discord_server.py",
        description=(
            "Export a full Discord guild snapshot using a bot token. By default this exports the configured "
            "guild metadata, every visible message-bearing container, archived threads, and metadata-only channels "
            "in one non-interactive run."
        ),
    )
    parser.add_argument("--env-file", help="Optional explicit .env file path. Defaults to the nearest .env above the script cwd.")
    parser.add_argument("--token", help="Explicit Discord bot token override.")
    parser.add_argument("--guild-id", help="Explicit Discord guild id override.")
    parser.add_argument("--token-env", default="PAZAAK_DISCORD_BOT_TOKEN", help="Env var name to read the bot token from.")
    parser.add_argument("--guild-id-env", default="PAZAAK_DISCORD_GUILD_ID", help="Primary env var name to read the guild id from.")
    parser.add_argument(
        "--fallback-guild-id-env",
        default="DISCORD_TARGET_GUILD_ID",
        help="Fallback env var name to read the guild id from when the primary guild id env var is absent.",
    )
    parser.add_argument(
        "--output-root",
        default=str(DEFAULT_OUTPUT_ROOT),
        help="Base directory used when --output-dir is not supplied. Default creates a timestamped export directory here.",
    )
    parser.add_argument("--output-dir", help="Explicit output directory for directory-based exports.")
    parser.add_argument("--output-file", help="Explicit single JSON file output path for aggregate exports.")
    parser.add_argument(
        "--include-channel",
        action="append",
        help="Explicitly narrow the export to specific channel or thread ids/names. May be repeated or comma-separated.",
    )
    parser.add_argument(
        "--exclude-channel",
        action="append",
        help="Exclude specific channel or thread ids/names. May be repeated or comma-separated.",
    )
    parser.add_argument(
        "--exclude-channel-type",
        action="append",
        choices=sorted(set(CHANNEL_TYPE_NAMES.values())),
        help="Exclude one or more Discord channel types by normalized type name.",
    )
    parser.add_argument("--exclude-archived-threads", action="store_true", help="Skip archived thread discovery and export.")
    parser.add_argument(
        "--exclude-private-archived-threads",
        action="store_true",
        help="Skip private archived thread discovery even when archived thread export is enabled.",
    )
    parser.add_argument("--metadata-only", action="store_true", help="Export metadata only without fetching message history.")
    parser.add_argument("--no-assets", action="store_true", help="Do not download attachments, avatars, emoji images, sticker assets, or embed media.")
    parser.add_argument("--no-reaction-users", action="store_true", help="Do not expand reactions into per-user lists.")
    parser.add_argument("--no-resume", action="store_true", help="Disable automatic resume from the latest matching directory export.")
    parser.add_argument(
        "--max-messages-per-container",
        type=int,
        help="Explicit cap on messages fetched per exported message-bearing container.",
    )
    parser.add_argument("--strict", action="store_true", help="Abort the whole export on the first per-container failure.")
    parser.add_argument("--verbose", action="store_true", help="Shortcut for --log-level debug.")
    parser.add_argument(
        "--log-level",
        choices=sorted(LOG_LEVEL_NAMES.keys()),
        default="info",
        help="Set the stderr log verbosity. Defaults to info.",
    )
    parser.add_argument("--color", action="store_true", help="Force ANSI color in log output.")
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI color in log output.")
    parser.add_argument("--json-summary", action="store_true", help="Emit the final summary as JSON instead of human-readable text.")
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS, help="HTTP timeout per Discord API request.")
    parser.add_argument("--max-retries", type=int, default=DEFAULT_MAX_RETRIES, help="Maximum retries for rate limits and transient failures.")
    return parser


def discover_repo_root(script_path: Path) -> Path:
    return script_path.resolve().parents[1]


def export_guild(options: ExportOptions, repo_root: Path) -> dict[str, Any]:
    del repo_root
    logger = Logger(level=options.log_level, color=options.color)
    client = DiscordApiClient(
        options.token,
        timeout_seconds=options.timeout_seconds,
        max_retries=options.max_retries,
        logger=logger,
    )
    exported_at = utc_now_iso()

    resume_output_location: Path | None = None
    if options.output_file is None and options.resume:
        if options.output_dir is not None and is_resume_checkpoint_dir(options.output_dir):
            resume_output_location = options.output_dir
        elif options.output_dir is None:
            resume_output_location = find_latest_resume_dir(options.output_root, options.guild_id)

    resume_manifest = None
    resume_guild_payload = None
    existing_asset_records: list[dict[str, Any]] = []
    if resume_output_location is not None:
        resume_manifest = read_json(resume_output_location / "manifest.json", logger=logger)
        resume_guild_payload = read_json(resume_output_location / "guild.json", logger=logger)
        existing_assets = read_json(resume_output_location / "assets-manifest.json", logger=logger)
        if isinstance(existing_assets, list):
            existing_asset_records = [record for record in existing_assets if isinstance(record, dict)]
        logger.info(f"Resuming existing export directory {resume_output_location}.")

    logger.info(f"Fetching bot identity and guild metadata for guild {options.guild_id}.")
    bot_user = None
    if isinstance(resume_manifest, dict) and isinstance(resume_manifest.get("bot_user"), dict):
        bot_user = resume_manifest["bot_user"]
    if not isinstance(bot_user, dict):
        bot_user = client.request_json("/users/@me")

    guild = None
    if isinstance(resume_guild_payload, dict) and isinstance(resume_guild_payload.get("guild"), dict):
        guild = resume_guild_payload["guild"]
    if not isinstance(guild, dict):
        guild = client.request_json(f"/guilds/{options.guild_id}")

    channels = None
    if isinstance(resume_guild_payload, dict) and isinstance(resume_guild_payload.get("channels"), list):
        channels = resume_guild_payload["channels"]
    if not isinstance(channels, list):
        channels = client.request_json(f"/guilds/{options.guild_id}/channels")

    active_threads = None
    if isinstance(resume_guild_payload, dict) and isinstance(resume_guild_payload.get("active_threads"), list):
        active_threads = resume_guild_payload["active_threads"]
    if not isinstance(active_threads, list):
        active_threads_payload = client.request_json(f"/guilds/{options.guild_id}/threads/active")
        if not isinstance(active_threads_payload, dict):
            raise RuntimeError("Unexpected response shape while listing active threads.")
        active_threads = active_threads_payload.get("threads", [])

    if options.output_file is not None:
        output_location = options.output_file
        asset_base_path = output_location.parent
        asset_root = output_location.parent / f"{output_location.stem}-assets"
    else:
        output_location = resume_output_location or options.output_dir or build_output_dir(
            options.output_root,
            str(guild.get("name", "guild")),
            str(guild.get("id", options.guild_id)),
        )
        asset_base_path = output_location
        asset_root = output_location / "assets"

    asset_store = (
        AssetStore(
            root=asset_root,
            base_path=asset_base_path,
            client=client,
            logger=logger,
            existing_records=existing_asset_records,
        )
        if options.download_assets
        else None
    )

    if not isinstance(channels, list):
        raise RuntimeError("Unexpected response shape while listing guild channels.")

    optional_resource_errors: list[dict[str, Any]] = []

    def fetch_optional_resource(name: str, getter: Callable[[], Any]) -> Any:
        try:
            return getter()
        except Exception as exc:
            logger.debug(f"Optional guild export for {name} unavailable: {exc}")
            optional_resource_errors.append({"resource": name, "error": str(exc)})
            return None

    roles = resume_guild_payload.get("roles") if isinstance(resume_guild_payload, dict) else None
    if roles is None:
        roles = fetch_optional_resource("roles", lambda: client.request_json(f"/guilds/{options.guild_id}/roles"))

    emojis = resume_guild_payload.get("emojis") if isinstance(resume_guild_payload, dict) else None
    if emojis is None:
        emojis = fetch_optional_resource("emojis", lambda: client.request_json(f"/guilds/{options.guild_id}/emojis"))

    stickers = resume_guild_payload.get("stickers") if isinstance(resume_guild_payload, dict) else None
    if stickers is None:
        stickers = fetch_optional_resource("stickers", lambda: client.request_json(f"/guilds/{options.guild_id}/stickers"))

    scheduled_events = resume_guild_payload.get("scheduled_events") if isinstance(resume_guild_payload, dict) else None
    if scheduled_events is None:
        scheduled_events = fetch_optional_resource("scheduled_events", lambda: client.request_json(f"/guilds/{options.guild_id}/scheduled-events"))

    welcome_screen = resume_guild_payload.get("welcome_screen") if isinstance(resume_guild_payload, dict) else None
    if welcome_screen is None:
        welcome_screen = fetch_optional_resource("welcome_screen", lambda: client.request_json(f"/guilds/{options.guild_id}/welcome-screen"))

    soundboard_sounds = resume_guild_payload.get("soundboard_sounds") if isinstance(resume_guild_payload, dict) else None
    if soundboard_sounds is None:
        soundboard_sounds = fetch_optional_resource("soundboard_sounds", lambda: client.request_json(f"/guilds/{options.guild_id}/soundboard-sounds"))

    vanity_url = resume_guild_payload.get("vanity_url") if isinstance(resume_guild_payload, dict) else None
    if vanity_url is None:
        vanity_url = fetch_optional_resource("vanity_url", lambda: client.request_json(f"/guilds/{options.guild_id}/vanity-url"))

    guild_widget = resume_guild_payload.get("widget") if isinstance(resume_guild_payload, dict) else None
    if guild_widget is None and bool(guild.get("widget_enabled")):
        guild_widget = fetch_optional_resource(
            "widget",
            lambda: client.request_public_json(f"{DISCORD_API_BASE}/guilds/{options.guild_id}/widget.json"),
        )

    widget_settings = resume_guild_payload.get("widget_settings") if isinstance(resume_guild_payload, dict) else None
    if widget_settings is None and bool(guild.get("widget_enabled")):
        widget_settings = fetch_optional_resource("widget_settings", lambda: client.request_json(f"/guilds/{options.guild_id}/widget"))

    members = resume_guild_payload.get("members") if isinstance(resume_guild_payload, dict) else None
    if members is None:
        members = fetch_optional_resource("members", lambda: fetch_all_members(client, options.guild_id))

    guild_emojis = emojis if isinstance(emojis, list) else []
    guild_stickers = stickers if isinstance(stickers, list) else []
    guild_roles = roles if isinstance(roles, list) else []
    guild_scheduled_events = scheduled_events if isinstance(scheduled_events, list) else []
    guild_soundboard_sounds = []
    if isinstance(soundboard_sounds, dict) and isinstance(soundboard_sounds.get("items"), list):
        guild_soundboard_sounds = soundboard_sounds["items"]
    elif isinstance(soundboard_sounds, list):
        guild_soundboard_sounds = soundboard_sounds
    guild_stickers_by_id = {str(sticker.get("id")): sticker for sticker in guild_stickers if isinstance(sticker, dict)}

    guild_asset_refs: list[dict[str, Any]] = []
    if asset_store is not None:
        for candidate in build_guild_asset_candidates(guild):
            record = asset_store.fetch(
                url=candidate["url"],
                category="guild-assets",
                suggested_name=candidate["suggested_name"],
                source_kind=candidate["source_kind"],
                source_ref={"guild_id": guild.get("id")},
            )
            if record is not None:
                guild_asset_refs.append({
                    "source_kind": candidate["source_kind"],
                    "asset_id": record["id"],
                    "path": record.get("path"),
                    "status": record.get("status"),
                })

        for emoji in guild_emojis:
            if not isinstance(emoji, dict):
                continue
            record = asset_store.fetch(
                url=build_emoji_asset_url(emoji),
                category="guild-emojis",
                suggested_name=f"{emoji.get('id', 'emoji')}.png",
                source_kind="guild_emoji",
                source_ref={"guild_id": guild.get("id"), "emoji_id": emoji.get("id")},
            )
            if record is not None:
                guild_asset_refs.append({
                    "source_kind": "guild_emoji",
                    "emoji_id": emoji.get("id"),
                    "asset_id": record["id"],
                    "path": record.get("path"),
                    "status": record.get("status"),
                })

        for sticker in guild_stickers:
            if not isinstance(sticker, dict):
                continue
            record = asset_store.fetch(
                url=build_sticker_asset_url(sticker),
                category="stickers",
                suggested_name=f"{sticker.get('id', 'sticker')}.png",
                source_kind="guild_sticker",
                source_ref={"guild_id": guild.get("id"), "sticker_id": sticker.get("id")},
            )
            if record is not None:
                guild_asset_refs.append({
                    "source_kind": "guild_sticker",
                    "sticker_id": sticker.get("id"),
                    "asset_id": record["id"],
                    "path": record.get("path"),
                    "status": record.get("status"),
                })

        for role in guild_roles:
            if not isinstance(role, dict):
                continue
            role_icon_url = build_role_icon_url(role)
            if not role_icon_url:
                continue
            record = asset_store.fetch(
                url=role_icon_url,
                category="role-icons",
                suggested_name=f"{role.get('id', 'role')}.png",
                source_kind="guild_role_icon",
                source_ref={"guild_id": guild.get("id"), "role_id": role.get("id")},
            )
            if record is not None:
                guild_asset_refs.append({
                    "source_kind": "guild_role_icon",
                    "role_id": role.get("id"),
                    "asset_id": record["id"],
                    "path": record.get("path"),
                    "status": record.get("status"),
                })

        for event in guild_scheduled_events:
            if not isinstance(event, dict):
                continue
            cover_url = build_scheduled_event_cover_url(event)
            if not cover_url:
                continue
            record = asset_store.fetch(
                url=cover_url,
                category="scheduled-event-covers",
                suggested_name=f"{event.get('id', 'event')}.png",
                source_kind="guild_scheduled_event_cover",
                source_ref={"guild_id": guild.get("id"), "event_id": event.get("id")},
            )
            if record is not None:
                guild_asset_refs.append({
                    "source_kind": "guild_scheduled_event_cover",
                    "event_id": event.get("id"),
                    "asset_id": record["id"],
                    "path": record.get("path"),
                    "status": record.get("status"),
                })

        for sound in guild_soundboard_sounds:
            if not isinstance(sound, dict):
                continue
            sound_url = build_soundboard_sound_asset_url(sound)
            if not sound_url:
                continue
            sound_id = str(sound.get("sound_id") or sound.get("id") or "sound").strip() or "sound"
            record = asset_store.fetch(
                url=sound_url,
                category="soundboard-sounds",
                suggested_name=sound_id,
                source_kind="guild_soundboard_sound",
                source_ref={"guild_id": guild.get("id"), "sound_id": sound.get("sound_id") or sound.get("id")},
            )
            if record is not None:
                guild_asset_refs.append({
                    "source_kind": "guild_soundboard_sound",
                    "sound_id": sound.get("sound_id") or sound.get("id"),
                    "asset_id": record["id"],
                    "path": record.get("path"),
                    "status": record.get("status"),
                })

        for widget_style in iter_guild_widget_image_styles():
            widget_image_url = build_guild_widget_image_url(str(guild.get("id", "")), style=widget_style)
            if not widget_image_url:
                continue
            record = asset_store.fetch(
                url=widget_image_url,
                category="guild-widget",
                suggested_name=f"widget-{widget_style}.png",
                source_kind="guild_widget_image",
                source_ref={"guild_id": guild.get("id"), "style": widget_style},
            )
            if record is not None:
                guild_asset_refs.append({
                    "source_kind": "guild_widget_image",
                    "style": widget_style,
                    "asset_id": record["id"],
                    "path": record.get("path"),
                    "status": record.get("status"),
                })

        widget_members = guild_widget.get("members") if isinstance(guild_widget, dict) else None
        if isinstance(widget_members, list):
            for index, widget_member in enumerate(widget_members):
                if not isinstance(widget_member, dict):
                    continue
                avatar_url = str(widget_member.get("avatar_url") or "").strip()
                if not avatar_url:
                    continue
                widget_member_id = str(widget_member.get("id") or index).strip() or str(index)
                record = asset_store.fetch(
                    url=avatar_url,
                    category="widget-avatars",
                    suggested_name=f"{widget_member_id}.png",
                    source_kind="guild_widget_member_avatar",
                    source_ref={
                        "guild_id": guild.get("id"),
                        "widget_member_id": widget_member_id,
                        "username": widget_member.get("username"),
                    },
                )
                if record is not None:
                    guild_asset_refs.append({
                        "source_kind": "guild_widget_member_avatar",
                        "widget_member_id": widget_member_id,
                        "username": widget_member.get("username"),
                        "asset_id": record["id"],
                        "path": record.get("path"),
                        "status": record.get("status"),
                    })

        for member in members if isinstance(members, list) else []:
            if not isinstance(member, dict):
                continue
            user = member.get("user") if isinstance(member.get("user"), dict) else None
            if not isinstance(user, dict):
                continue

            member_avatar_url = build_member_avatar_url(str(guild.get("id") or ""), member)
            if member_avatar_url:
                record = asset_store.fetch(
                    url=member_avatar_url,
                    category="member-avatars",
                    suggested_name=f"{user.get('id', 'member')}.png",
                    source_kind="guild_member_avatar",
                    source_ref={"guild_id": guild.get("id"), "user_id": user.get("id")},
                )
                if record is not None:
                    guild_asset_refs.append({
                        "source_kind": "guild_member_avatar",
                        "user_id": user.get("id"),
                        "asset_id": record["id"],
                        "path": record.get("path"),
                        "status": record.get("status"),
                    })

            user_avatar_url = build_avatar_url(user)
            if user_avatar_url:
                record = asset_store.fetch(
                    url=user_avatar_url,
                    category="user-avatars",
                    suggested_name=f"{user.get('id', 'user')}.png",
                    source_kind="guild_member_user_avatar",
                    source_ref={"guild_id": guild.get("id"), "user_id": user.get("id")},
                )
                if record is not None:
                    guild_asset_refs.append({
                        "source_kind": "guild_member_user_avatar",
                        "user_id": user.get("id"),
                        "asset_id": record["id"],
                        "path": record.get("path"),
                        "status": record.get("status"),
                    })

            user_banner_url = build_user_banner_url(user)
            if user_banner_url:
                record = asset_store.fetch(
                    url=user_banner_url,
                    category="user-banners",
                    suggested_name=f"{user.get('id', 'user')}.png",
                    source_kind="guild_member_user_banner",
                    source_ref={"guild_id": guild.get("id"), "user_id": user.get("id")},
                )
                if record is not None:
                    guild_asset_refs.append({
                        "source_kind": "guild_member_user_banner",
                        "user_id": user.get("id"),
                        "asset_id": record["id"],
                        "path": record.get("path"),
                        "status": record.get("status"),
                    })

            avatar_decoration_url = build_avatar_decoration_url(user)
            if avatar_decoration_url:
                record = asset_store.fetch(
                    url=avatar_decoration_url,
                    category="avatar-decorations",
                    suggested_name=f"{user.get('id', 'user')}.png",
                    source_kind="guild_member_avatar_decoration",
                    source_ref={"guild_id": guild.get("id"), "user_id": user.get("id")},
                )
                if record is not None:
                    guild_asset_refs.append({
                        "source_kind": "guild_member_avatar_decoration",
                        "user_id": user.get("id"),
                        "asset_id": record["id"],
                        "path": record.get("path"),
                        "status": record.get("status"),
                    })

            nameplate_ref = get_collectible_nameplate(user)
            if nameplate_ref is not None:
                guild_asset_refs.append({
                    "source_kind": "guild_member_user_nameplate",
                    "user_id": user.get("id"),
                    **nameplate_ref,
                })

            display_name_style_ref = get_display_name_style_metadata(user)
            if display_name_style_ref is not None:
                guild_asset_refs.append({
                    "source_kind": "guild_member_user_display_name_style",
                    "user_id": user.get("id"),
                    **display_name_style_ref,
                })

            for badge_field in ["clan", "primary_guild"]:
                badge_owner = user.get(badge_field)
                if not isinstance(badge_owner, dict):
                    continue
                badge_url = build_clan_badge_url(badge_owner)
                if not badge_url:
                    continue
                record = asset_store.fetch(
                    url=badge_url,
                    category="clan-badges",
                    suggested_name=f"{user.get('id', 'user')}-{badge_field}.png",
                    source_kind=f"guild_member_{badge_field}_badge",
                    source_ref={"guild_id": guild.get("id"), "user_id": user.get("id")},
                )
                if record is not None:
                    guild_asset_refs.append({
                        "source_kind": f"guild_member_{badge_field}_badge",
                        "user_id": user.get("id"),
                        "asset_id": record["id"],
                        "path": record.get("path"),
                        "status": record.get("status"),
                    })

    top_level_channels = [channel for channel in channels if int(channel.get("type", -1)) not in THREAD_CHANNEL_TYPES]
    if not isinstance(active_threads, list):
        raise RuntimeError("Unexpected response shape for active thread list.")

    archived_threads = []
    if isinstance(resume_guild_payload, dict) and isinstance(resume_guild_payload.get("archived_threads"), list):
        archived_threads = resume_guild_payload["archived_threads"]
    archived_thread_errors: list[dict[str, Any]] = []

    if options.include_archived_threads and not archived_threads:
        logger.info("Discovering archived threads across eligible parent channels.")
        for parent_channel in sort_channels(top_level_channels):
            if int(parent_channel.get("type", -1)) not in THREAD_PARENT_TYPES:
                continue

            parent_id = str(parent_channel.get("id"))
            for archived_kind in ["threads/archived/public"]:
                try:
                    archived_threads.extend(fetch_archived_threads(client, parent_id, archived_kind))
                except Exception as exc:
                    logger.debug(
                        f"Archived thread scope {archived_kind} unavailable for {parent_channel.get('name')} ({parent_id}): {exc}"
                    )
                    archived_thread_errors.append({
                        "parent_channel_id": parent_id,
                        "parent_channel_name": parent_channel.get("name"),
                        "scope": archived_kind,
                        "error": str(exc),
                    })
                    if options.strict:
                        raise

            if options.include_private_archived_threads:
                for archived_kind in ["threads/archived/private", "users/@me/threads/archived/private"]:
                    try:
                        archived_threads.extend(fetch_archived_threads(client, parent_id, archived_kind))
                    except Exception as exc:
                        logger.debug(
                            f"Archived thread scope {archived_kind} unavailable for {parent_channel.get('name')} ({parent_id}): {exc}"
                        )
                        archived_thread_errors.append({
                            "parent_channel_id": parent_id,
                            "parent_channel_name": parent_channel.get("name"),
                            "scope": archived_kind,
                            "error": str(exc),
                        })
                        if options.strict:
                            raise

    deduped_threads: dict[str, dict[str, Any]] = {}
    for thread in active_threads + archived_threads:
        deduped_threads[str(thread.get("id"))] = thread

    container_summaries_by_id: dict[str, dict[str, Any]] = {}
    failures_by_id: dict[str, dict[str, Any]] = {}
    if isinstance(resume_manifest, dict):
        for summary in resume_manifest.get("containers", []):
            if not isinstance(summary, dict):
                continue
            container_id = str(summary.get("id", "")).strip()
            if container_id:
                container_summaries_by_id[container_id] = summary
        for failure in resume_manifest.get("failures", []):
            if not isinstance(failure, dict):
                continue
            container_id = str(failure.get("container_id", "")).strip()
            if container_id:
                failures_by_id[container_id] = failure

    candidate_containers: list[tuple[str, dict[str, Any]]] = []
    candidate_containers.extend(("top_level", channel) for channel in sort_channels(top_level_channels))
    candidate_containers.extend(("thread", thread) for thread in sort_threads(deduped_threads.values()))

    logger.info(f"Preparing to export {len(candidate_containers)} visible containers.")

    def write_progress() -> None:
        container_summaries = list(container_summaries_by_id.values())
        failures = list(failures_by_id.values())
        manifest = build_manifest(
            exported_at=exported_at,
            bot_user=cast(dict[str, Any], bot_user),
            guild=cast(dict[str, Any], guild),
            options=options,
            top_level_channels=top_level_channels,
            active_threads=active_threads,
            archived_threads=archived_threads,
            archived_thread_errors=archived_thread_errors,
            optional_resource_errors=optional_resource_errors,
            container_summaries=container_summaries,
            failures=failures,
            asset_store=asset_store,
            members=members,
            roles=roles,
            guild_emojis=guild_emojis,
            guild_stickers=guild_stickers,
            scheduled_events=scheduled_events,
            welcome_screen=welcome_screen,
            soundboard_sounds=guild_soundboard_sounds,
            guild_widget=guild_widget,
            widget_settings=widget_settings,
            vanity_url=vanity_url,
            guild_asset_refs=guild_asset_refs,
        )
        guild_payload = {
            "exported_at": exported_at,
            "guild": guild,
            "roles": roles,
            "emojis": guild_emojis,
            "stickers": guild_stickers,
            "scheduled_events": scheduled_events,
            "welcome_screen": welcome_screen,
            "soundboard_sounds": guild_soundboard_sounds,
            "vanity_url": vanity_url,
            "widget": guild_widget,
            "widget_settings": widget_settings,
            "members": members,
            "channels": sort_channels(top_level_channels),
            "active_threads": sort_threads(active_threads),
            "archived_threads": sort_threads(archived_threads),
            "guild_asset_refs": guild_asset_refs,
        }

        if options.output_file is not None:
            return

        write_json(output_location / "manifest.json", manifest)
        write_json(output_location / "guild.json", guild_payload)
        if asset_store is not None:
            write_json(output_location / "assets-manifest.json", asset_store.manifest())

    if options.output_file is None:
        write_progress()

    deferred_asset_containers: list[tuple[str, dict[str, Any], str, str]] = []
    container_payloads_by_id: dict[str, dict[str, Any]] = {}

    for container_scope, channel in candidate_containers:
        if not is_selected_container(channel, options.include_channels, options.exclude_channels, options.exclude_channel_types):
            logger.debug(f"Skipping filtered container {format_container_log_fields(channel, container_scope)}.")
            continue

        container_id = str(channel.get("id", "")).strip()
        file_name = container_file_name(channel)
        container_log_fields = format_container_log_fields(channel, container_scope)

        existing_payload = None
        if options.output_file is None and options.resume:
            existing_payload = read_json(output_location / "containers" / file_name, logger=logger)
            if isinstance(existing_payload, dict):
                existing_errors = existing_payload.get("errors")
                if isinstance(existing_errors, list) and not existing_errors and payload_satisfies_message_phase(existing_payload, options=options):
                    container_summaries_by_id[container_id] = build_container_summary(existing_payload, file_name=file_name)
                    container_payloads_by_id[container_id] = existing_payload
                    failures_by_id.pop(container_id, None)
                    if asset_store is not None and not payload_satisfies_asset_phase(existing_payload, options=options):
                        deferred_asset_containers.append((container_scope, channel, container_id, file_name))
                    logger.debug(f"Skipping already exported container {container_log_fields} during message pass.")
                    continue

        channel_type = int(channel.get("type", -1))
        should_fetch_messages = (not options.metadata_only) and (
            channel_type in TOP_LEVEL_MESSAGE_CHANNEL_TYPES or channel_type in THREAD_CHANNEL_TYPES
        )

        messages: list[dict[str, Any]] | None = None
        errors: list[str] = []

        try:
            logger.info(
                f"Exporting container {container_log_fields} mode={'with messages' if should_fetch_messages else 'metadata only'}."
            )
            if should_fetch_messages:
                reused_cached_messages = False
                container_checkpoint: Callable[[], None] | None = None
                if isinstance(existing_payload, dict):
                    cached_messages = existing_payload.get("messages")
                    if isinstance(cached_messages, list):
                        messages = cached_messages
                        reused_cached_messages = True
                        if options.output_file is None:
                            cached_payload = cast(dict[str, Any], existing_payload)
                            def persist_cached_progress() -> None:
                                write_json(output_location / "containers" / file_name, cached_payload)
                                container_summaries_by_id[container_id] = build_container_summary(cached_payload, file_name=file_name)
                                failures_by_id.pop(container_id, None)
                                write_progress()
                            container_checkpoint = persist_cached_progress

                if messages is None:
                    messages = export_messages(client, str(channel["id"]), options.max_messages_per_container)
                    logger.debug(f"Fetched {len(messages)} messages for {container_log_fields}.")
                else:
                    logger.debug(f"Reused cached {len(messages)} messages for {container_log_fields}.")

                reaction_enriched = False
                if options.include_reaction_users and not payload_has_reaction_user_enrichment({"messages": messages}):
                    enrich_messages_with_reaction_users_checkpointed(
                        client,
                        messages,
                        checkpoint=container_checkpoint,
                        progress=lambda processed, total, count: logger.debug(
                            f"Reaction enrichment progress {container_log_fields} messages={processed}/{total} users={count}."
                        ),
                        progress_interval=50,
                    )
                    reaction_enriched = True

                if reused_cached_messages and reaction_enriched:
                    logger.debug(
                        f"Backfilled cached container {container_log_fields}"
                        f"{' with reaction users' if reaction_enriched else ''}"
                        "."
                    )
        except Exception as exc:
            errors.append(str(exc))
            logger.warning(
                f"Continuing after container failure for {container_log_fields}: {format_exception_for_log(exc)}"
            )
            if options.strict:
                raise

        payload = build_container_payload(
            channel=channel,
            container_scope=container_scope,
            messages=messages,
            exported_at=exported_at,
            errors=errors,
        )
        container_payloads_by_id[container_id] = payload
        summary = build_container_summary(payload, file_name=file_name)
        container_summaries_by_id[container_id] = summary
        failure_entry = build_failure_entry(payload)
        if failure_entry is not None:
            failures_by_id[container_id] = failure_entry
        else:
            failures_by_id.pop(container_id, None)

        if options.output_file is None:
            write_json(output_location / "containers" / file_name, payload)
            write_progress()

        if should_fetch_messages and asset_store is not None and not payload_satisfies_asset_phase(payload, options=options):
            deferred_asset_containers.append((container_scope, channel, container_id, file_name))

    if deferred_asset_containers and asset_store is not None:
        logger.info(
            f"Starting deferred media download pass for {len(deferred_asset_containers)} containers after message export."
        )
        for container_scope, channel, container_id, file_name in deferred_asset_containers:
            container_log_fields = format_container_log_fields(channel, container_scope)

            existing_payload = None
            if options.output_file is None:
                existing_payload = read_json(output_location / "containers" / file_name, logger=logger)
            else:
                existing_payload = container_payloads_by_id.get(container_id)

            if not isinstance(existing_payload, dict):
                logger.debug(f"Skipping deferred media pass for missing payload {container_log_fields}.")
                continue

            existing_errors = existing_payload.get("errors")
            if isinstance(existing_errors, list) and existing_errors:
                logger.debug(f"Skipping deferred media pass for failed container {container_log_fields}.")
                continue

            messages = existing_payload.get("messages")
            if not isinstance(messages, list):
                logger.debug(f"Skipping deferred media pass for metadata-only container {container_log_fields}.")
                continue

            if payload_satisfies_asset_phase(existing_payload, options=options):
                logger.debug(f"Skipping already media-complete container {container_log_fields}.")
                continue

            logger.info(f"Downloading media for container {container_log_fields}.")
            try:
                enrich_messages_with_assets_checkpointed(
                    asset_store,
                    messages,
                    guild_stickers_by_id,
                    checkpoint=lambda: write_json(output_location / "containers" / file_name, existing_payload),
                    progress=lambda processed, total, count: logger.debug(
                        f"Deferred media progress {container_log_fields} messages={processed}/{total} asset_refs={count}."
                    ),
                    progress_interval=50,
                )
            except Exception as exc:
                logger.warning(
                    f"Continuing after deferred media failure for {container_log_fields}: {format_exception_for_log(exc)}"
                )
                if options.strict:
                    raise

            summary = build_container_summary(existing_payload, file_name=file_name)
            container_payloads_by_id[container_id] = existing_payload
            container_summaries_by_id[container_id] = summary
            failure_entry = build_failure_entry(existing_payload)
            if failure_entry is not None:
                failures_by_id[container_id] = failure_entry
            else:
                failures_by_id.pop(container_id, None)

            write_json(output_location / "containers" / file_name, existing_payload)
            write_progress()

    container_summaries = list(container_summaries_by_id.values())
    failures = list(failures_by_id.values())
    manifest = build_manifest(
        exported_at=exported_at,
        bot_user=cast(dict[str, Any], bot_user),
        guild=cast(dict[str, Any], guild),
        options=options,
        top_level_channels=top_level_channels,
        active_threads=active_threads,
        archived_threads=archived_threads,
        archived_thread_errors=archived_thread_errors,
        optional_resource_errors=optional_resource_errors,
        container_summaries=container_summaries,
        failures=failures,
        asset_store=asset_store,
        members=members,
        roles=roles,
        guild_emojis=guild_emojis,
        guild_stickers=guild_stickers,
        scheduled_events=scheduled_events,
        welcome_screen=welcome_screen,
        soundboard_sounds=guild_soundboard_sounds,
        guild_widget=guild_widget,
        widget_settings=widget_settings,
        vanity_url=vanity_url,
        guild_asset_refs=guild_asset_refs,
    )

    guild_payload = {
        "exported_at": exported_at,
        "guild": guild,
        "roles": roles,
        "emojis": guild_emojis,
        "stickers": guild_stickers,
        "scheduled_events": scheduled_events,
        "welcome_screen": welcome_screen,
        "soundboard_sounds": guild_soundboard_sounds,
        "vanity_url": vanity_url,
        "widget": guild_widget,
        "widget_settings": widget_settings,
        "members": members,
        "channels": sort_channels(top_level_channels),
        "active_threads": sort_threads(active_threads),
        "archived_threads": sort_threads(archived_threads),
        "guild_asset_refs": guild_asset_refs,
    }

    if options.output_file is not None:
        aggregate_payload = {
            "manifest": manifest,
            "guild_payload": guild_payload,
            "containers": [],
            "assets": asset_store.manifest() if asset_store is not None else [],
        }
        logger.info(f"Writing aggregate export file to {options.output_file}.")
        write_json(options.output_file, aggregate_payload)
    else:
        logger.info(f"Writing directory export to {output_location}.")
        write_json(output_location / "manifest.json", manifest)
        write_json(output_location / "guild.json", guild_payload)
        if asset_store is not None:
            write_json(output_location / "assets-manifest.json", asset_store.manifest())

    counts = cast(dict[str, Any], manifest["counts"])
    guild_resource_summary = cast(dict[str, Any], manifest["guild_resource_summary"])
    logger.info(
        "Guild resource summary: "
        f"welcome_screen={guild_resource_summary['welcome_screen']} "
        f"soundboard_sounds={guild_resource_summary['soundboard_sound_count']} "
        f"vanity_url={guild_resource_summary['vanity_url']} "
        f"widget_json={guild_resource_summary['widget_json']} "
        f"widget_settings={guild_resource_summary['widget_settings']} "
        f"widget_members={guild_resource_summary['widget_member_count']} "
        f"widget_styles={guild_resource_summary['widget_image_style_count']}"
    )
    logger.success(
        "Export complete: "
        f"{counts['exported_container_count']} containers, "
        f"{counts['total_message_count']} messages, "
        f"{counts['failed_container_count']} container failures."
    )

    return {
        "manifest": manifest,
        "output_location": str(output_location),
    }


def render_summary(result: dict[str, Any], *, as_json: bool) -> str:
    manifest = result["manifest"]
    guild_resource_summary = manifest["guild_resource_summary"]
    summary = {
        "guild_id": manifest["guild"]["id"],
        "guild_name": manifest["guild"]["name"],
        "exported_at": manifest["exported_at"],
        "output_location": result["output_location"],
        "exported_container_count": manifest["counts"]["exported_container_count"],
        "failed_container_count": manifest["counts"]["failed_container_count"],
        "total_message_count": manifest["counts"]["total_message_count"],
        "downloaded_asset_count": manifest["counts"]["downloaded_asset_count"],
        "container_asset_ref_count": manifest["counts"]["container_asset_ref_count"],
        "guild_asset_ref_count": manifest["counts"]["guild_asset_ref_count"],
        "total_asset_ref_count": manifest["counts"]["total_asset_ref_count"],
        "guild_resource_summary": guild_resource_summary,
    }
    if as_json:
        return json.dumps(summary, indent=2)

    return "\n".join(
        [
            f"Guild: {summary['guild_name']} ({summary['guild_id']})",
            f"Exported at: {summary['exported_at']}",
            f"Output: {summary['output_location']}",
            f"Exported containers: {summary['exported_container_count']}",
            f"Failed containers: {summary['failed_container_count']}",
            f"Total messages: {summary['total_message_count']}",
            f"Downloaded assets: {summary['downloaded_asset_count']}",
            (
                "Asset refs: "
                f"container={summary['container_asset_ref_count']} "
                f"guild={summary['guild_asset_ref_count']} "
                f"total={summary['total_asset_ref_count']}"
            ),
            (
                "Guild resources: "
                f"welcome_screen={guild_resource_summary['welcome_screen']} "
                f"soundboard_sounds={guild_resource_summary['soundboard_sound_count']} "
                f"vanity_url={guild_resource_summary['vanity_url']} "
                f"widget_json={guild_resource_summary['widget_json']} "
                f"widget_settings={guild_resource_summary['widget_settings']} "
                f"widget_members={guild_resource_summary['widget_member_count']} "
                f"widget_styles={guild_resource_summary['widget_image_style_count']}"
            ),
        ]
    )


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    script_path = Path(__file__)
    repo_root = discover_repo_root(script_path)

    env_path = Path(args.env_file) if args.env_file else find_dotenv(Path.cwd()) or find_dotenv(repo_root)
    env_file_values = load_env_file(env_path) if env_path and env_path.exists() else {}
    env = merge_environment(env_file_values)
    options = determine_options(args, env, repo_root)

    try:
        result = export_guild(options, repo_root)
    except OSError as exc:
        if exc.errno == 28:
            print(
                "Export failed: no space left on device. Free disk space and rerun the exporter; checkpoint JSON files are now written atomically so valid cached progress can be resumed safely.",
                file=sys.stderr,
            )
            return 1
        raise

    print(render_summary(result, as_json=options.json_summary))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())