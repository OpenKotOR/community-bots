from trask_indexer.chunk import chunk_markdown


def test_chunk_markdown_splits_long_text():
    text = "word " * 500
    chunks = chunk_markdown(text, url="https://example.com", max_chars=200, overlap_chars=20)
    assert len(chunks) > 1
    assert all(c.text for c in chunks)


def test_chunk_markdown_splits_on_headings():
    text = "## Alpha\n\n" + ("alpha " * 80) + "\n\n## Beta\n\n" + ("beta " * 80)
    chunks = chunk_markdown(text, url="https://example.com", max_chars=400, overlap_chars=20)
    assert len(chunks) >= 2
    joined = " ".join(c.text for c in chunks)
    assert "Alpha" in joined
    assert "Beta" in joined
    # Chunks should not merge unrelated headings into one piece when sections are small enough.
    assert not any("Alpha" in c.text and "Beta" in c.text for c in chunks)

