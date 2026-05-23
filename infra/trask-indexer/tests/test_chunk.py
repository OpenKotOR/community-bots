from trask_indexer.chunk import chunk_markdown


def test_chunk_markdown_splits_long_text():
    text = "word " * 500
    chunks = chunk_markdown(text, url="https://example.com", max_chars=200, overlap_chars=20)
    assert len(chunks) > 1
    assert all(c.text for c in chunks)
