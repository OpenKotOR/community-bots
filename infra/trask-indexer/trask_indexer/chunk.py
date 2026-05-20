from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class TextChunk:
    chunk_id: str
    text: str
    content_hash: str


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def chunk_markdown(
    markdown: str,
    *,
    url: str,
    max_chars: int = 1800,
    overlap_chars: int = 200,
) -> list[TextChunk]:
    """Split markdown into overlapping chunks by character window."""
    normalized = re.sub(r"\n{3,}", "\n\n", markdown.strip())
    if not normalized:
        return []

    chunks: list[TextChunk] = []
    start = 0
    index = 0
    while start < len(normalized):
        end = min(len(normalized), start + max_chars)
        piece = normalized[start:end].strip()
        if piece:
            digest = content_hash(piece)
            chunk_id = f"{digest}:{index}"
            chunks.append(TextChunk(chunk_id=chunk_id, text=piece, content_hash=digest))
            index += 1
        if end >= len(normalized):
            break
        start = max(0, end - overlap_chars)
    return chunks
