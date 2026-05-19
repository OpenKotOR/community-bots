from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from trask_indexer.embed import embed_query, embed_texts

DEFAULT_COLLECTION = os.environ.get("TRASK_CHROMA_COLLECTION", "trask_dev")


@dataclass(frozen=True)
class PassageHit:
    id: str
    url: str
    host: str
    quote: str
    score: float
    source_id: str


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


def query_passages(
    collection,
    query: str,
    *,
    limit: int = 8,
    host_filter: str | None = None,
) -> list[PassageHit]:
    if not query.strip():
        return []
    vector = embed_query(query)
    where = {"host": host_filter} if host_filter else None
    result = collection.query(
        query_embeddings=[vector],
        n_results=limit,
        include=["documents", "metadatas", "distances"],
        where=where,
    )
    hits: list[PassageHit] = []
    ids = result.get("ids") or [[]]
    docs = result.get("documents") or [[]]
    metas = result.get("metadatas") or [[]]
    dists = result.get("distances") or [[]]
    for row_id, doc, meta, dist in zip(ids[0], docs[0], metas[0], dists[0], strict=False):
        meta = meta or {}
        # Chroma returns distance; lower is closer — invert to a simple score.
        score = 1.0 / (1.0 + float(dist or 0.0))
        quote = (doc or "")[:500]
        hits.append(
            PassageHit(
                id=row_id,
                url=str(meta.get("url", "")),
                host=str(meta.get("host", "")),
                quote=quote,
                score=score,
                source_id=str(meta.get("source_id", "")),
            )
        )
    return hits
