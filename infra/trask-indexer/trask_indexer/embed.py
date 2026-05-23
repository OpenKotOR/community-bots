from __future__ import annotations

import os
from functools import lru_cache

DEFAULT_EMBED_MODEL = os.environ.get("TRASK_EMBED_MODEL", "BAAI/bge-small-en-v1.5")


@lru_cache(maxsize=1)
def get_embedder():
    from fastembed import TextEmbedding

    return TextEmbedding(model_name=DEFAULT_EMBED_MODEL)


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    model = get_embedder()
    return [vec.tolist() for vec in model.embed(texts)]


def embed_query(query: str) -> list[float]:
    vectors = embed_texts([query])
    return vectors[0] if vectors else []
