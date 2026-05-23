from pathlib import Path

import pytest

from trask_indexer.batch_crawl import run_batch_crawl


def test_run_batch_crawl_dry_run(tmp_path: Path, monkeypatch):
    data_dir = tmp_path / "indexer"
    data_dir.mkdir()
    allowlist = data_dir / "allowlist.json"
    allowlist.write_text(
        """{
  "baseHosts": ["example.com"],
  "urlPrefixes": ["https://example.com/"],
  "sources": [
    {"id": "ex", "homeUrl": "https://example.com/docs", "name": "Example"}
  ]
}""",
        encoding="utf-8",
    )
    monkeypatch.setenv("TRASK_INDEXER_DATA_DIR", str(data_dir))
    result = run_batch_crawl(dry_run=True, data_dir=data_dir)
    assert result.dry_run is True
    assert result.attempted == 1


def test_run_batch_crawl_missing_allowlist(tmp_path: Path):
    data_dir = tmp_path / "empty"
    data_dir.mkdir()
    with pytest.raises(FileNotFoundError):
        run_batch_crawl(dry_run=True, data_dir=data_dir)
