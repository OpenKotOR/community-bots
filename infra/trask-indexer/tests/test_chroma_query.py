from trask_indexer.chroma_store import _lexical_score, _rrf, _url_anchor_boost


def test_lexical_score_prefers_matching_tokens():
    q = "Where are KOTOR save files stored on Windows?"
    high = _lexical_score(q, "Knights save files are stored under Documents on Windows.")
    low = _lexical_score(q, "TSLPatcher installs mods using 2DA files.")
    assert high > low


def test_rrf_is_monotonic_by_rank():
    assert _rrf(0) > _rrf(1) > _rrf(2)


def test_url_anchor_boost_rewards_tool_name_in_url():
    boost = _url_anchor_boost("What is TSLPatcher used for?", "https://deadlystream.com/files/file/123-tslpatcher/")
    assert boost > 0
