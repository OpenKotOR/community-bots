import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { mergeDiscordSearchHits } from "./discord-channel-search.js";
import type { SearchHit } from "@openkotor/retrieval";

const hit = (url: string, score: number): SearchHit => ({
  sourceId: "approved-discord-knowledge",
  sourceName: "Approved Discord Knowledge",
  kind: "discord",
  title: "msg",
  snippet: "content",
  url,
  score,
  tags: [],
});

describe("mergeDiscordSearchHits", () => {
  test("dedupes by URL and sorts by score", () => {
    const merged = mergeDiscordSearchHits(
      [hit("https://discord.com/channels/1/2/3", 2)],
      [hit("https://discord.com/channels/1/2/3", 9), hit("https://discord.com/channels/1/2/4", 1)],
    );
    assert.equal(merged.length, 2);
    assert.equal(merged[0]!.url, "https://discord.com/channels/1/2/3");
    assert.equal(merged[0]!.score, 9);
  });
});
