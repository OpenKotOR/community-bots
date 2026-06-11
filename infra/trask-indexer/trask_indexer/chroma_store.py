from __future__ import annotations

from typing import Any

import os
import re
from dataclasses import dataclass, replace
from pathlib import Path

from trask_indexer.embed import embed_query, embed_texts

_RRF_K = 60
_TOKEN_RE = re.compile(r"[a-z0-9]+", re.IGNORECASE)


def _tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if len(t) > 2]


def _lexical_score(query: str, doc: str) -> float:
    q = set(_tokenize(query))
    if not q:
        return 0.0
    d = set(_tokenize(doc))
    return len(q & d) / len(q)


def _rrf(rank: int) -> float:
    return 1.0 / (_RRF_K + rank + 1)


def _url_anchor_boost(query: str, url: str) -> float:
    url_lower = url.lower()
    boost = 0.0
    for token in _tokenize(query):
        if len(token) >= 5 and token in url_lower:
            boost += 0.08
    return boost

DEFAULT_COLLECTION = os.environ.get("TRASK_CHROMA_COLLECTION", "trask_dev")


@dataclass(frozen=True)
class PassageHit:
    id: str
    url: str
    host: str
    quote: str
    score: float
    source_id: str
    guild_id: str = ""
    channel_id: str = ""
    first_message_id: str = ""
    last_message_id: str = ""
    source_type: str = "web"
    source_target: str = ""
    indexed_at: str = ""
    source_freshness_at: str = ""
    discord_jump_url: str = ""
    content_hash: str = ""
    deleted: bool = False


def get_chroma_client(persist_dir: Path):
    import chromadb

    persist_dir.mkdir(parents=True, exist_ok=True)
    return chromadb.PersistentClient(path=str(persist_dir))


def get_or_create_collection(client, name: str = DEFAULT_COLLECTION):
    return client.get_or_create_collection(name=name, metadata={"hnsw:space": "cosine"})


def upsert_chunks(
    collection,
    *,
    url: str,
    host: str,
    source_id: str,
    chunks: list,
    extra_metadata: dict[str, str] | None = None,
) -> int:
    if not chunks:
        return 0
    texts = [c.text for c in chunks]
    ids = [f"{source_id}:{c.chunk_id}" for c in chunks]
    embeddings = embed_texts(texts)
    base_meta = dict(extra_metadata or {})
    metadatas = [
        {
            "url": url,
            "host": host,
            "source_id": source_id,
            "content_hash": c.content_hash,
            **base_meta,
        }
        for c in chunks
    ]
    collection.upsert(ids=ids, documents=texts, embeddings=embeddings, metadatas=metadatas)
    return len(ids)


def upsert_discord_windows(
    collection,
    windows: list[dict[str, Any]],
) -> int:
    """Batch embed + upsert multiple Discord message windows in one embedding call."""
    if not windows:
        return 0
    texts: list[str] = []
    ids: list[str] = []
    metadatas: list[dict[str, str]] = []
    for window in windows:
        url = str(window["url"])
        host = str(window["host"])
        source_id = str(window["source_id"])
        chunks = window["chunks"]
        extra_metadata = dict(window.get("extra_metadata") or {})
        for chunk in chunks:
            texts.append(chunk.text)
            ids.append(f"{source_id}:{chunk.chunk_id}")
            metadatas.append(
                {
                    "url": url,
                    "host": host,
                    "source_id": source_id,
                    "content_hash": chunk.content_hash,
                    **extra_metadata,
                },
            )
    if not texts:
        return 0
    embeddings = embed_texts(texts)
    collection.upsert(ids=ids, documents=texts, embeddings=embeddings, metadatas=metadatas)
    return len(ids)


def query_passages(
    collection,
    query: str,
    *,
    limit: int = 8,
    host_filter: str | None = None,
) -> list[PassageHit]:
    if not query.strip():
        return []
    recall = min(max(limit * 3, 15), 30)
    vector = embed_query(query)
    where = {"host": host_filter} if host_filter else None
    result = collection.query(
        query_embeddings=[vector],
        n_results=recall,
        include=["documents", "metadatas", "distances"],
        where=where,
    )
    hits: list[PassageHit] = []
    full_docs: dict[str, str] = {}
    ids = result.get("ids") or [[]]
    docs = result.get("documents") or [[]]
    metas = result.get("metadatas") or [[]]
    dists = result.get("distances") or [[]]
    for row_id, doc, meta, dist in zip(ids[0], docs[0], metas[0], dists[0], strict=False):
        meta = meta or {}
        # Chroma returns distance; lower is closer — invert to a simple score.
        score = 1.0 / (1.0 + float(dist or 0.0))
        full_doc = doc or ""
        full_docs[row_id] = full_doc
        quote = full_doc[:1200]
        deleted = str(meta.get("deleted", "") or "").lower() in {"1", "true", "yes"}
        if deleted:
            continue
        hits.append(
            PassageHit(
                id=row_id,
                url=str(meta.get("url", "")),
                host=str(meta.get("host", "")),
                quote=quote,
                score=score,
                source_id=str(meta.get("source_id", "")),
                guild_id=str(meta.get("guild_id", "") or ""),
                channel_id=str(meta.get("channel_id", "") or ""),
                first_message_id=str(meta.get("first_message_id", "") or ""),
                last_message_id=str(meta.get("last_message_id", "") or ""),
                source_type=str(meta.get("source_type", "") or ("discord" if str(meta.get("url", "")).startswith("discord://") else "web")),
                source_target=str(meta.get("source_target", "") or ""),
                indexed_at=str(meta.get("indexed_at", "") or ""),
                source_freshness_at=str(meta.get("source_freshness_at", "") or ""),
                discord_jump_url=str(meta.get("discord_jump_url", "") or ""),
                content_hash=str(meta.get("content_hash", "") or ""),
                deleted=deleted,
            )
        )
    if not hits:
        return []

    dense_rank = {h.id: i for i, h in enumerate(hits)}
    lex_sorted = sorted(
        hits,
        key=lambda h: _lexical_score(query, f"{h.url} {full_docs.get(h.id, h.quote)}"),
        reverse=True,
    )
    lex_rank = {h.id: i for i, h in enumerate(lex_sorted)}

    fused: list[tuple[float, PassageHit]] = []
    for h in hits:
        fused_score = _rrf(dense_rank[h.id]) + _rrf(lex_rank[h.id]) + _url_anchor_boost(query, h.url)
        fused.append((fused_score, replace(h, score=round(fused_score, 6))))

    fused.sort(key=lambda pair: pair[0], reverse=True)
    return [h for _, h in fused[:limit]]


def purge_discord_message_rows(
    collection,
    *,
    channel_id: str,
    message_id: str,
    guild_id: str | None = None,
    dry_run: bool = False,
) -> list[str]:
    """Delete Discord evidence chunks whose stored message window contains `message_id`."""
    channel = channel_id.strip()
    message = message_id.strip()
    if not channel or not message:
        return []
    try:
        target = int(message)
    except ValueError:
        return []
    result = collection.get(where={"channel_id": channel}, include=["metadatas"])
    ids = result.get("ids") or []
    metas = result.get("metadatas") or []
    doomed: list[str] = []
    for row_id, meta in zip(ids, metas, strict=False):
        meta = meta or {}
        if guild_id and str(meta.get("guild_id", "") or "") != guild_id:
            continue
        try:
            first = int(str(meta.get("first_message_id", "") or "0"))
            last = int(str(meta.get("last_message_id", "") or meta.get("first_message_id", "") or "0"))
        except ValueError:
            continue
        lower, upper = sorted((first, last))
        if lower <= target <= upper:
            doomed.append(str(row_id))
    if doomed and not dry_run:
        collection.delete(ids=doomed)
    return doomed
