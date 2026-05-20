from __future__ import annotations

import json
import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from trask_indexer.chroma_store import (
    DEFAULT_COLLECTION,
    get_chroma_client,
    get_or_create_collection,
    query_passages,
)

DATA_DIR = Path(os.environ.get("TRASK_INDEXER_DATA_DIR", "data/trask-indexer"))
PERSIST_DIR = DATA_DIR / "chroma"


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


def create_app() -> FastAPI:
    app = FastAPI(title="Trask indexer retrieve API", version="0.1.0")
    client = get_chroma_client(PERSIST_DIR)
    collection = get_or_create_collection(client, DEFAULT_COLLECTION)

    @app.get("/health")
    def health():
        payload: dict[str, object] = {"ok": True, "collection": DEFAULT_COLLECTION}
        status_path = DATA_DIR / "discord_sync_status.json"
        if status_path.is_file():
            try:
                status = json.loads(status_path.read_text(encoding="utf-8"))
                if isinstance(status, dict) and status.get("last_discord_sync"):
                    payload["last_discord_sync"] = status["last_discord_sync"]
            except json.JSONDecodeError:
                pass
        return payload

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
