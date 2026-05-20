import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDiscordJumpUrl,
  isDiscordJumpUrl,
  parseDiscordInternalUrl,
  resolvePublicCitationUrl,
} from "./discord-citation-url.js";

test("parseDiscordInternalUrl reads channel and message window", () => {
  const parsed = parseDiscordInternalUrl("discord://channels/900000000000000001/1000000000000000001-1000000000000000002");
  assert.deepEqual(parsed, {
    channelId: "900000000000000001",
    firstMessageId: "1000000000000000001",
    lastMessageId: "1000000000000000002",
  });
});

test("buildDiscordJumpUrl formats public message link", () => {
  const url = buildDiscordJumpUrl("111", "222", "333");
  assert.equal(url, "https://discord.com/channels/111/222/333");
  assert.equal(isDiscordJumpUrl(url!), true);
});

test("resolvePublicCitationUrl converts discord internal when guild metadata present", () => {
  const url = resolvePublicCitationUrl("discord://channels/222/333", {
    guildId: "111",
    channelId: "222",
    firstMessageId: "333",
  });
  assert.equal(url, "https://discord.com/channels/111/222/333");
});
