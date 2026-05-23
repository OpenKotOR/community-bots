from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


@dataclass(frozen=True)
class AllowlistSource:
    id: str
    home_url: str
    name: str


@dataclass(frozen=True)
class AllowlistCatalog:
    base_hosts: tuple[str, ...]
    url_prefixes: tuple[str, ...]
    sources: tuple[AllowlistSource, ...]

    def is_approved_url(self, url: str) -> bool:
        try:
            parsed = urlparse(url)
        except ValueError:
            return False
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return False
        if not any(_host_matches_base(hostname, base) for base in self.base_hosts):
            return False
        return any(url.startswith(prefix) for prefix in self.url_prefixes)


def _host_matches_base(hostname: str, base_host: str) -> bool:
    host = hostname.lower().rstrip(".")
    base = base_host.lower().rstrip(".")
    return host == base or host.endswith(f".{base}")


def load_allowlist(path: Path) -> AllowlistCatalog:
    raw = json.loads(path.read_text(encoding="utf-8"))
    sources = tuple(
        AllowlistSource(id=s["id"], home_url=s["homeUrl"], name=s["name"])
        for s in raw.get("sources", [])
    )
    return AllowlistCatalog(
        base_hosts=tuple(raw.get("baseHosts", [])),
        url_prefixes=tuple(raw.get("urlPrefixes", [])),
        sources=sources,
    )


def default_allowlist_path(data_dir: Path) -> Path:
    return data_dir / "allowlist.json"
