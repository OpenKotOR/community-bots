from pathlib import Path

from trask_indexer.allowlist import AllowlistCatalog, AllowlistSource, load_allowlist


def test_is_approved_url_matches_prefix(tmp_path: Path):
    catalog = AllowlistCatalog(
        base_hosts=("kotor.neocities.org",),
        url_prefixes=("https://kotor.neocities.org/",),
        sources=(
            AllowlistSource(
                id="kotor-neocities",
                home_url="https://kotor.neocities.org/",
                name="KOTOR Neocities",
            ),
        ),
    )
    assert catalog.is_approved_url("https://kotor.neocities.org/modding/tslpatcher")
    assert not catalog.is_approved_url("https://evil.example/page")


def test_load_allowlist_json(tmp_path: Path):
    path = tmp_path / "allowlist.json"
    path.write_text(
        """
        {
          "baseHosts": ["deadlystream.com"],
          "urlPrefixes": ["https://deadlystream.com/"],
          "sources": [
            {"id": "ds", "homeUrl": "https://deadlystream.com/", "name": "Deadly Stream"}
          ]
        }
        """,
        encoding="utf-8",
    )
    catalog = load_allowlist(path)
    assert catalog.is_approved_url("https://deadlystream.com/topic/1-test/")
