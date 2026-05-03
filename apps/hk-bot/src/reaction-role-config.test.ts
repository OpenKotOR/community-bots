import assert from "node:assert/strict";
import test from "node:test";

import {
  discordEmojiKey,
  normalizeConfigEmoji,
  parseReactionRolePanelsJson,
} from "./reaction-role-config.js";

void test("discordEmojiKey uses name:id for custom emoji", () => {
  assert.equal(discordEmojiKey({ id: "123456789012345678", name: "hkrole" }), "hkrole:123456789012345678");
});

void test("discordEmojiKey uses name only for unicode", () => {
  assert.equal(discordEmojiKey({ id: null, name: "✅" }), "✅");
});

void test("normalizeConfigEmoji accepts unicode literal", () => {
  const r = normalizeConfigEmoji(" ✅ ");
  assert.equal(r.ok, true);
  assert.deepEqual(r, { ok: true, key: "✅" });
});

void test("normalizeConfigEmoji accepts custom name:snowflake", () => {
  const r = normalizeConfigEmoji("hkrole:123456789012345678");
  assert.equal(r.ok, true);
  assert.deepEqual(r, { ok: true, key: "hkrole:123456789012345678" });
});

void test("normalizeConfigEmoji rejects bad custom id", () => {
  const r = normalizeConfigEmoji("hkrole:notanid");
  assert.equal(r.ok, false);
});

void test("normalizeConfigEmoji rejects empty", () => {
  const r = normalizeConfigEmoji("   ");
  assert.equal(r.ok, false);
});

void test("parseReactionRolePanelsJson parses panels and mappings", () => {
  const snap = parseReactionRolePanelsJson(`{
    "version": 1,
    "defaultAnnounceMode": "dm",
    "replyCooldownMs": 5000,
    "panels": [
      {
        "channelId": "111111111111111111",
        "messageId": "222222222222222222",
        "announceMode": "silent",
        "mappings": [
          { "emoji": "✅", "roleId": "333333333333333333" },
          { "emoji": "custom:444444444444444444", "curatedRoleId": "reone" }
        ]
      }
    ]
  }`);

  assert.equal(snap.defaultAnnounceMode, "dm");
  assert.equal(snap.replyCooldownMs, 5000);
  assert.equal(snap.panels.length, 1);
  const panel = snap.panels[0]!;
  assert.equal(panel.channelId, "111111111111111111");
  assert.equal(panel.messageId, "222222222222222222");
  assert.equal(panel.announceMode, "silent");
  assert.equal(panel.mappings.length, 2);
  assert.deepEqual(panel.mappings[0], { emojiKeys: ["✅"], roleId: "333333333333333333" });
  assert.deepEqual(panel.mappings[1], { emojiKeys: ["custom:444444444444444444"], curatedRoleId: "reone" });
});

void test("parseReactionRolePanelsJson inherits default announce mode", () => {
  const snap = parseReactionRolePanelsJson(`{
    "panels": [
      {
        "channelId": "111111111111111111",
        "messageId": "222222222222222222",
        "mappings": [{ "emoji": "x", "roleId": "333333333333333333" }]
      }
    ]
  }`);

  assert.equal(snap.panels[0]!.announceMode, "reply");
});

void test("parseReactionRolePanelsJson merges emoji and emojis with dedupe", () => {
  const snap = parseReactionRolePanelsJson(`{
    "panels": [
      {
        "channelId": "111111111111111111",
        "messageId": "222222222222222222",
        "mappings": [
          {
            "emoji": "🎮",
            "emojis": ["🎮", "✅"],
            "roleId": "333333333333333333"
          }
        ]
      }
    ]
  }`);

  assert.deepEqual(snap.panels[0]!.mappings[0]!.emojiKeys, ["🎮", "✅"]);
});

void test("parseReactionRolePanelsJson accepts roleNameHint alone", () => {
  const snap = parseReactionRolePanelsJson(`{
    "panels": [
      {
        "channelId": "111111111111111111",
        "messageId": "222222222222222222",
        "mappings": [{ "emoji": "⭐", "roleNameHint": "Star Forge Regulars" }]
      }
    ]
  }`);

  assert.deepEqual(snap.panels[0]!.mappings[0], {
    emojiKeys: ["⭐"],
    roleNameHint: "Star Forge Regulars",
  });
});
