import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  anchorMessageIdFromChunkTags,
  buildDiscordMessagePermalink,
  channelIdFromChunkTags,
  guildIdFromChunkTags,
  isDiscordCitationUrl,
  resolveDiscordChunkCitationUrl,
} from "./discord-permalink.js";

describe("discord permalink helpers", () => {
  test("buildDiscordMessagePermalink formats discord.com URL", () => {
    assert.equal(
      buildDiscordMessagePermalink("111", "222", "333"),
      "https://discord.com/channels/111/222/333",
    );
  });

  test("resolveDiscordChunkCitationUrl prefers stored HTTPS permalink", () => {
    const url = resolveDiscordChunkCitationUrl({
      url: "https://discord.com/channels/g/c/m",
      tags: [],
    });
    assert.equal(url, "https://discord.com/channels/g/c/m");
  });

  test("resolveDiscordChunkCitationUrl builds from discord:// and tags", () => {
    const url = resolveDiscordChunkCitationUrl(
      {
        url: "discord://approved-channels/9001/8001-8002",
        tags: ["guild:1001", "channel:9001", "anchorMessage:8001"],
      },
      "fallback-should-not-use",
    );
    assert.equal(url, "https://discord.com/channels/1001/9001/8001");
  });

  test("tag parsers read guild channel and anchor", () => {
    const tags = ["guild:g1", "channel:c1", "anchorMessage:m1"];
    assert.equal(guildIdFromChunkTags(tags), "g1");
    assert.equal(channelIdFromChunkTags(tags), "c1");
    assert.equal(anchorMessageIdFromChunkTags(tags), "m1");
  });

  test("isDiscordCitationUrl recognizes discord schemes", () => {
    assert.equal(isDiscordCitationUrl("discord://approved-channels/1/2"), true);
    assert.equal(isDiscordCitationUrl("https://discord.com/channels/1/2/3"), true);
    assert.equal(isDiscordCitationUrl("https://example.com"), false);
  });
});
