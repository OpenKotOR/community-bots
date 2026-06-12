from trask_indexer.chroma_store import _lexical_score, _rrf, _url_anchor_boost, purge_discord_message_rows, query_passages


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


def test_query_passages_filters_deleted_rows_and_exposes_metadata(monkeypatch):
    monkeypatch.setattr("trask_indexer.chroma_store.embed_query", lambda _query: [0.1, 0.2])

    class FakeCollection:
        def query(self, **_kwargs):
            return {
                "ids": [["live", "deleted"]],
                "documents": [["TSLPatcher installs mod files.", "Deleted staff note"]],
                "distances": [[0.1, 0.2]],
                "metadatas": [[
                    {
                        "url": "discord://channels/456/100-101",
                        "host": "discord:modding",
                        "source_id": "approved-discord-knowledge:openkotor:456",
                        "source_type": "discord",
                        "source_target": "openkotor",
                        "guild_id": "123",
                        "channel_id": "456",
                        "first_message_id": "100",
                        "last_message_id": "101",
                        "discord_jump_url": "https://discord.com/channels/123/456/100",
                        "deleted": "false",
                    },
                    {
                        "url": "discord://channels/456/99-99",
                        "host": "discord:staff",
                        "source_id": "approved-discord-knowledge:staff:456",
                        "deleted": "true",
                    },
                ]],
            }

    hits = query_passages(FakeCollection(), "TSLPatcher", limit=3)

    assert len(hits) == 1
    assert hits[0].source_type == "discord"
    assert hits[0].source_target == "openkotor"
    assert hits[0].discord_jump_url == "https://discord.com/channels/123/456/100"
    assert hits[0].last_message_id == "101"


def test_query_passages_promotes_exact_topic_over_generic_dense_neighbor(monkeypatch):
    monkeypatch.setattr("trask_indexer.chroma_store.embed_query", lambda _query: [0.1, 0.2])

    class FakeCollection:
        def query(self, **_kwargs):
            return {
                "ids": [["kotorjs-generic", "github-tslpatcher", "deadlystream-tslpatcher"]],
                "documents": [[
                    "KotOR.js is a TypeScript reimplementation of the Odyssey engine.",
                    "TSLPatcher documents list-driven 2DA, GFF, and TLK changes for KotOR mods.",
                    "TSLPatcher installs Knights of the Old Republic mods from patch lists.",
                ]],
                "distances": [[0.01, 0.08, 0.09]],
                "metadatas": [[
                    {
                        "url": "https://github.com/KobaltBlu/KotOR.js",
                        "host": "github.com",
                        "source_id": "kotorjs-repo",
                    },
                    {
                        "url": "https://github.com/th3w1zard1/TSLPatcher",
                        "host": "github.com",
                        "source_id": "github-tslpatcher",
                    },
                    {
                        "url": "https://deadlystream.com/files/file/1982-tslpatcher/",
                        "host": "deadlystream.com",
                        "source_id": "deadlystream-tslpatcher",
                    },
                ]],
            }

    hits = query_passages(FakeCollection(), "TSLPatcher patch lists for KotOR 2DA GFF and TLK modding", limit=3)

    assert hits[0].source_id in {"github-tslpatcher", "deadlystream-tslpatcher"}
    assert hits[-1].source_id == "kotorjs-repo"


def test_purge_discord_message_rows_matches_message_windows():
    deleted: list[str] = []

    class FakeCollection:
        def get(self, **_kwargs):
            return {
                "ids": ["a", "b", "c"],
                "metadatas": [
                    {"guild_id": "123", "channel_id": "456", "first_message_id": "100", "last_message_id": "110"},
                    {"guild_id": "123", "channel_id": "456", "first_message_id": "120", "last_message_id": "130"},
                    {"guild_id": "999", "channel_id": "456", "first_message_id": "100", "last_message_id": "110"},
                ],
            }

        def delete(self, *, ids):
            deleted.extend(ids)

    matched = purge_discord_message_rows(
        FakeCollection(),
        guild_id="123",
        channel_id="456",
        message_id="105",
    )

    assert matched == ["a"]
    assert deleted == ["a"]
