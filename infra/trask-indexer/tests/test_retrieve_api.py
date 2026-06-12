from __future__ import annotations

from concurrent.futures import TimeoutError

from fastapi.testclient import TestClient

from trask_indexer.chroma_store import PassageHit
from trask_indexer import retrieve_api as retrieve_module


def _hit():
    return PassageHit(
        id="hit-1",
        url="https://example.com/tslpatcher",
        host="example.com",
        quote="TSLPatcher edits KOTOR files.",
        score=0.99,
        source_id="s-1",
        guild_id="",
        channel_id="",
        first_message_id="",
        last_message_id="",
        source_type="web",
        source_target="",
        indexed_at="",
        source_freshness_at="",
        discord_jump_url="",
        content_hash="",
        deleted=False,
    )


def test_retrieve_api_falls_back_to_sqlite_when_dense_disabled(tmp_path, monkeypatch):
    monkeypatch.setattr(retrieve_module, "DATA_DIR", tmp_path)
    monkeypatch.setattr(retrieve_module, "PERSIST_DIR", tmp_path / "chroma")
    monkeypatch.setenv("TRASK_INDEXER_DENSE_RETRIEVE", "0")
    monkeypatch.setattr(retrieve_module, "query_passages_sqlite_fallback", lambda *args, **kwargs: [_hit()])

    with TestClient(retrieve_module.create_app()) as client:
        response = client.post("/retrieve", json={"query": "TSLPatcher", "limit": 2})

    assert response.status_code == 200
    payload = response.json()
    assert payload["evidencePack"]["backend"] == "sqlite-lexical-fallback"
    assert payload["evidencePack"]["retrievalMode"] == "cached-sqlite-lexical"
    assert payload["evidencePack"]["exclusionNotes"][0] == "dense retrieve disabled; used cached SQLite lexical fallback"


def test_retrieve_api_prefers_dense_when_enabled_and_records_rrf_backend(tmp_path, monkeypatch):
    monkeypatch.setattr(retrieve_module, "DATA_DIR", tmp_path)
    monkeypatch.setattr(retrieve_module, "PERSIST_DIR", tmp_path / "chroma")
    monkeypatch.setenv("TRASK_INDEXER_DENSE_RETRIEVE", "1")
    monkeypatch.setattr(retrieve_module, "_query_passages_with_collection", lambda _body: [_hit()])

    with TestClient(retrieve_module.create_app()) as client:
        response = client.post("/retrieve", json={"query": "TSLPatcher", "limit": 2})

    assert response.status_code == 200
    payload = response.json()
    assert payload["evidencePack"]["backend"] == "chroma-hybrid-rrf"
    assert payload["evidencePack"]["retrievalMode"] == "dense+lexical-rrf"


def test_retrieve_api_fallback_to_sqlite_on_dense_timeout(tmp_path, monkeypatch):
    monkeypatch.setattr(retrieve_module, "DATA_DIR", tmp_path)
    monkeypatch.setattr(retrieve_module, "PERSIST_DIR", tmp_path / "chroma")
    monkeypatch.setenv("TRASK_INDEXER_DENSE_RETRIEVE", "1")
    monkeypatch.setenv("TRASK_INDEXER_RETRIEVE_TIMEOUT_MS", "1")
    monkeypatch.setattr(retrieve_module, "_query_passages_with_collection", lambda _body: (_ for _ in ()).throw(TimeoutError()))
    monkeypatch.setattr(retrieve_module, "query_passages_sqlite_fallback", lambda *args, **kwargs: [_hit()])

    with TestClient(retrieve_module.create_app()) as client:
        response = client.post("/retrieve", json={"query": "TSLPatcher", "limit": 2})

    assert response.status_code == 200
    payload = response.json()
    assert payload["evidencePack"]["backend"] == "sqlite-lexical-fallback"
    assert payload["evidencePack"]["retrievalMode"] == "cached-sqlite-lexical"
    assert payload["evidencePack"]["exclusionNotes"][0].startswith("dense retrieve timed out")
