from __future__ import annotations

import logging
import os
import threading
import time
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from trask_indexer.batch_crawl import run_batch_crawl
from trask_indexer.chroma_store import (
    DEFAULT_COLLECTION,
    get_chroma_client,
    get_or_create_collection,
    query_passages,
)
from trask_indexer.health import build_health_payload

LOG = logging.getLogger("trask_indexer.retrieve_api")

DATA_DIR = Path(os.environ.get("TRASK_INDEXER_DATA_DIR", "data/trask-indexer"))
PERSIST_DIR = DATA_DIR / "chroma"

def _reindex_token() -> str:
    """Shared bearer token gating the scheduled weekly reindex trigger.

    Read live (not at import) so deployments and tests can configure it. When unset
    the endpoint is disabled so it can never be invoked as an open crawl trigger.
    """
    return (os.environ.get("TRASK_REINDEX_TOKEN", "") or "").strip()


# Single-flight guard + last-run status for the weekly refresh (REQ-A).
_reindex_lock = threading.Lock()
_reindex_running = False
_reindex_status: dict[str, object] = {"last_started_at": None, "last_finished_at": None, "last_result": None}


class RetrieveRequest(BaseModel):
    query: str = Field(min_length=1)
    limit: int = Field(default=12, ge=1, le=30)
    host: str | None = None


class PassageDto(BaseModel):
    id: str
    url: str
    host: str
    quote: str
    score: float
    sourceId: str
    guildId: str = ""
    channelId: str = ""
    firstMessageId: str = ""


class RetrieveResponse(BaseModel):
    passages: list[PassageDto]


class ReindexRequest(BaseModel):
    # Cap the crawl so a scheduled trigger cannot run unbounded; None = full catalog.
    limit: int | None = Field(default=None, ge=1, le=200)
    dryRun: bool = False


def _run_scheduled_reindex(limit: int | None, dry_run: bool) -> None:
    """Background weekly refresh of the cached corpus (REQ-A)."""
    global _reindex_running
    try:
        result = run_batch_crawl(limit=limit, dry_run=dry_run, data_dir=DATA_DIR)
        _reindex_status["last_result"] = {
            "attempted": result.attempted,
            "indexed": result.indexed,
            "failed": result.failed,
            "dryRun": result.dry_run,
        }
        LOG.info(
            "scheduled_reindex done attempted=%s indexed=%s failed=%s dry_run=%s",
            result.attempted, result.indexed, result.failed, result.dry_run,
        )
    except Exception as exc:  # noqa: BLE001
        _reindex_status["last_result"] = {"error": str(exc)}
        LOG.exception("scheduled_reindex failed: %s", exc)
    finally:
        _reindex_status["last_finished_at"] = time.time()
        with _reindex_lock:
            _reindex_running = False


def create_app() -> FastAPI:
    app = FastAPI(title="Trask indexer retrieve API", version="0.1.0")
    client = get_chroma_client(PERSIST_DIR)
    collection = get_or_create_collection(client, DEFAULT_COLLECTION)

    @app.get("/health")
    def health():
        payload = build_health_payload(DATA_DIR, collection=DEFAULT_COLLECTION)
        payload["reindex"] = {
            "enabled": bool(_reindex_token()),
            "running": _reindex_running,
            **_reindex_status,
        }
        return payload

    @app.post("/reindex", status_code=202)
    def reindex(
        body: ReindexRequest,
        background_tasks: BackgroundTasks,
        authorization: str | None = Header(default=None),
    ):
        global _reindex_running
        token = _reindex_token()
        if not token:
            raise HTTPException(status_code=503, detail="reindex disabled: set TRASK_REINDEX_TOKEN")
        presented = ""
        if authorization and authorization.lower().startswith("bearer "):
            presented = authorization[len("bearer "):].strip()
        if presented != token:
            raise HTTPException(status_code=401, detail="invalid or missing reindex token")
        with _reindex_lock:
            if _reindex_running:
                return {"status": "already_running", **_reindex_status}
            _reindex_running = True
            _reindex_status["last_started_at"] = time.time()
            _reindex_status["last_finished_at"] = None
        background_tasks.add_task(_run_scheduled_reindex, body.limit, body.dryRun)
        return {"status": "accepted", "limit": body.limit, "dryRun": body.dryRun}

    @app.post("/retrieve", response_model=RetrieveResponse)
    def retrieve(body: RetrieveRequest):
        try:
            hits = query_passages(
                collection,
                body.query,
                limit=body.limit,
                host_filter=body.host,
            )
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        return RetrieveResponse(
            passages=[
                PassageDto(
                    id=h.id,
                    url=h.url,
                    host=h.host,
                    quote=h.quote,
                    score=h.score,
                    sourceId=h.source_id,
                    guildId=h.guild_id,
                    channelId=h.channel_id,
                    firstMessageId=h.first_message_id,
                )
                for h in hits
            ]
        )

    return app


app = create_app()
