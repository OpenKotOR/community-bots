from __future__ import annotations

import time

import pytest
from fastapi.testclient import TestClient

from trask_indexer import retrieve_api
from trask_indexer.batch_crawl import BatchCrawlResult


@pytest.fixture()
def client(tmp_path, monkeypatch):
    # Point the API at an empty temp data dir so health/Chroma stay isolated.
    monkeypatch.setattr(retrieve_api, "DATA_DIR", tmp_path)
    monkeypatch.setattr(retrieve_api, "PERSIST_DIR", tmp_path / "chroma")
    # Reset module-level single-flight state between tests.
    monkeypatch.setattr(retrieve_api, "_reindex_running", False, raising=False)
    return TestClient(retrieve_api.create_app())


def test_reindex_disabled_without_token(client, monkeypatch):
    monkeypatch.delenv("TRASK_REINDEX_TOKEN", raising=False)
    res = client.post("/reindex", json={})
    assert res.status_code == 503
    assert "TRASK_REINDEX_TOKEN" in res.json()["detail"]


def test_reindex_rejects_missing_or_bad_token(client, monkeypatch):
    monkeypatch.setenv("TRASK_REINDEX_TOKEN", "s3cret")
    assert client.post("/reindex", json={}).status_code == 401
    bad = client.post("/reindex", json={}, headers={"Authorization": "Bearer nope"})
    assert bad.status_code == 401


def test_reindex_accepts_valid_token_and_runs_background(client, monkeypatch):
    monkeypatch.setenv("TRASK_REINDEX_TOKEN", "s3cret")
    calls: list[dict] = []

    def fake_crawl(*, limit=None, dry_run=False, data_dir=None):
        calls.append({"limit": limit, "dry_run": dry_run})
        return BatchCrawlResult(attempted=3, indexed=3, failed=0, dry_run=dry_run)

    monkeypatch.setattr(retrieve_api, "run_batch_crawl", fake_crawl)

    res = client.post(
        "/reindex",
        json={"limit": 5, "dryRun": True},
        headers={"Authorization": "Bearer s3cret"},
    )
    assert res.status_code == 202
    assert res.json()["status"] == "accepted"
    # TestClient runs background tasks synchronously after the response.
    assert calls == [{"limit": 5, "dry_run": True}]

    health = client.get("/health").json()
    assert health["reindex"]["enabled"] is True
    assert health["reindex"]["last_result"]["attempted"] == 3


def test_health_reports_reindex_disabled(client, monkeypatch):
    monkeypatch.delenv("TRASK_REINDEX_TOKEN", raising=False)
    health = client.get("/health").json()
    assert health["reindex"]["enabled"] is False
