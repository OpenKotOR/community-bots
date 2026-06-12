from __future__ import annotations

import hmac
import logging
import os
import threading
import time
from collections.abc import AsyncIterator
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from trask_indexer.chroma_store import (
    DEFAULT_COLLECTION,
    get_chroma_client,
    get_or_create_collection,
    query_passages,
    query_passages_sqlite_fallback,
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
_collection_lock = threading.Lock()
_collection = None


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
    lastMessageId: str = ""
    sourceType: str = "web"
    sourceTarget: str = ""
    indexedAt: str = ""
    sourceFreshnessAt: str = ""
    discordJumpUrl: str = ""
    contentHash: str = ""
    deleted: bool = False
    authorizationHint: str = "public-web"


class EvidencePackDto(BaseModel):
    query: str
    backend: str = "chroma-hybrid-rrf"
    retrievalMode: str = "dense+lexical-rrf"
    retrievedAt: str
    passagesCount: int
    citationReadyCount: int
    rerankStatus: str = "not_configured"
    exclusionNotes: list[str] = Field(default_factory=list)


class RetrieveResponse(BaseModel):
    passages: list[PassageDto]
    evidencePack: EvidencePackDto


class ReindexRequest(BaseModel):
    # Cap the crawl so a scheduled trigger cannot run unbounded; None = full catalog.
    limit: int | None = Field(default=None, ge=1, le=200)
    dryRun: bool = False


def _run_scheduled_reindex(limit: int | None, dry_run: bool) -> None:
    """Background weekly refresh of the cached corpus (REQ-A)."""
    global _reindex_running
    try:
        from trask_indexer.batch_crawl import run_batch_crawl

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


def _get_collection():
    global _collection
    if _collection is not None:
        return _collection
    with _collection_lock:
        if _collection is not None:
            return _collection
        client = get_chroma_client(PERSIST_DIR)
        _collection = get_or_create_collection(client, DEFAULT_COLLECTION)
        return _collection


def _retrieve_timeout_seconds() -> float:
    try:
        timeout_ms = int(os.environ.get("TRASK_INDEXER_RETRIEVE_TIMEOUT_MS", "5000"))
    except ValueError:
        timeout_ms = 5000
    return max(0.5, timeout_ms / 1000)


def _query_passages_with_collection(body: "RetrieveRequest"):
    return query_passages(
        _get_collection(),
        body.query,
        limit=body.limit,
        host_filter=body.host,
    )


def _dense_retrieve_enabled() -> bool:
    return os.environ.get("TRASK_INDEXER_DENSE_RETRIEVE", "").strip().lower() in {"1", "true", "yes", "on"}


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.query_executor = ThreadPoolExecutor(max_workers=1)
    try:
        yield
    finally:
        app.state.query_executor.shutdown(wait=False, cancel_futures=True)


def create_app() -> FastAPI:
    app = FastAPI(title="Trask indexer retrieve API", version="0.1.0", lifespan=_lifespan)

    @app.get("/health")
    def health():
        payload = build_health_payload(DATA_DIR, collection=DEFAULT_COLLECTION)
        payload["index"] = {
            "sqlite_fallback": (PERSIST_DIR / "chroma.sqlite3").exists(),
        }
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
        if not hmac.compare_digest(presented or "", token):
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
        started = time.monotonic()
        LOG.info("retrieve start limit=%s host=%s dense=%s", body.limit, body.host, _dense_retrieve_enabled())
        exclusion_notes: list[str] = []

        if not _dense_retrieve_enabled():
            hits = query_passages_sqlite_fallback(PERSIST_DIR, body.query, limit=body.limit, host_filter=body.host)
            backend = "sqlite-lexical-fallback"
            retrieval_mode = "cached-sqlite-lexical"
            if not hits:
                raise HTTPException(status_code=503, detail="cached SQLite retrieve returned no passages")
            exclusion_notes.append("dense retrieve disabled; used cached SQLite lexical fallback")
        else:
            backend = "chroma-hybrid-rrf"
            retrieval_mode = "dense+lexical-rrf"
            try:
                future = app.state.query_executor.submit(_query_passages_with_collection, body)
                hits = future.result(timeout=_retrieve_timeout_seconds())
            except FutureTimeoutError as exc:
                future.cancel()
                hits = query_passages_sqlite_fallback(PERSIST_DIR, body.query, limit=body.limit, host_filter=body.host)
                backend = "sqlite-lexical-fallback"
                retrieval_mode = "cached-sqlite-lexical"
                exclusion_notes.append("dense retrieve timed out; used cached SQLite lexical fallback")
                if not hits:
                    raise HTTPException(status_code=503, detail="retrieve timed out while loading or querying the index") from exc
            except Exception as exc:  # noqa: BLE001
                hits = query_passages_sqlite_fallback(PERSIST_DIR, body.query, limit=body.limit, host_filter=body.host)
                backend = "sqlite-lexical-fallback"
                retrieval_mode = "cached-sqlite-lexical"
                exclusion_notes.append(f"dense retrieve failed; used cached SQLite lexical fallback: {exc}")
                if not hits:
                    raise HTTPException(status_code=503, detail=str(exc)) from exc

        passages = [
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
                lastMessageId=h.last_message_id,
                sourceType=h.source_type,
                sourceTarget=h.source_target,
                indexedAt=h.indexed_at,
                sourceFreshnessAt=h.source_freshness_at,
                discordJumpUrl=h.discord_jump_url,
                contentHash=h.content_hash,
                deleted=h.deleted,
                authorizationHint="discord-destination-check-required" if h.source_type == "discord" else "public-web",
            )
            for h in hits
        ]
        if len(passages) < body.limit:
            exclusion_notes.append("retrieve returned fewer passages than requested; corpus may be thin or filtered")
        LOG.info(
            "retrieve return backend=%s passages=%s elapsed_ms=%s",
            backend,
            len(passages),
            int((time.monotonic() - started) * 1000),
        )
        return RetrieveResponse(
            passages=passages,
            evidencePack=EvidencePackDto(
                query=body.query,
                backend=backend,
                retrievalMode=retrieval_mode,
                retrievedAt=datetime.now(timezone.utc).isoformat(),
                passagesCount=len(passages),
                citationReadyCount=sum(1 for passage in passages if passage.url.startswith("http") or passage.discordJumpUrl.startswith("https://discord.com/channels/")),
                exclusionNotes=exclusion_notes,
            ),
        )

    return app


app = create_app()
