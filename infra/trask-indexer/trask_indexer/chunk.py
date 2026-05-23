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


_HEADING_SPLIT_RE = re.compile(r"(?=^#{1,3}\s+)", re.MULTILINE)


def _split_markdown_sections(markdown: str) -> list[str]:
    """Split on ATX headings so chunks stay within topical sections."""
    parts = [p.strip() for p in _HEADING_SPLIT_RE.split(markdown) if p.strip()]
    return parts if parts else [markdown.strip()] if markdown.strip() else []


def _chunk_text_window(
    text: str,
    *,
    url: str,
    max_chars: int,
    overlap_chars: int,
    index_offset: int,
) -> tuple[list[TextChunk], int]:
    normalized = re.sub(r"\n{3,}", "\n\n", text.strip())
    if not normalized:
        return [], index_offset

    chunks: list[TextChunk] = []
    start = 0
    index = index_offset
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
    return chunks, index


def chunk_markdown(
    markdown: str,
    *,
    url: str,
    max_chars: int = 1800,
    overlap_chars: int = 200,
) -> list[TextChunk]:
    """Split markdown by heading sections, then overlapping character windows."""
    normalized = re.sub(r"\n{3,}", "\n\n", markdown.strip())
    if not normalized:
        return []

    sections = _split_markdown_sections(normalized)
    chunks: list[TextChunk] = []
    index = 0
    for section in sections:
        section_chunks, index = _chunk_text_window(
            section,
            url=url,
            max_chars=max_chars,
            overlap_chars=overlap_chars,
            index_offset=index,
        )
        chunks.extend(section_chunks)
    return chunks
