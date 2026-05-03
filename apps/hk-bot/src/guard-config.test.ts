import assert from "node:assert/strict";
import test from "node:test";

import { parseGuardConfigJson } from "./guard-config.js";

void test("parseGuardConfigJson parses honeypot, welcome, autorole, and logging settings", () => {
  const config = parseGuardConfigJson(`{
    "version": 1,
    "enabled": true,
    "logChannelId": "111111111111111111",
    "trustedRoleIds": ["222222222222222222"],
    "honeypot": {
      "channelIds": ["333333333333333333"],
      "quarantineRoleId": "444444444444444444",
      "deleteTriggerMessage": true,
      "ignoreMembersOlderThanMs": 86400000,
      "ignoreAccountsOlderThanMs": 604800000
    },
    "labyrinth": {
      "entryRoleId": "555555555555555555",
      "verifiedRoleIds": ["666666666666666666"]
    },
    "welcome": {
      "channelId": "777777777777777777",
      "message": "Statement: Welcome, $mention. Proceed through the labyrinth."
    },
    "autoroles": ["888888888888888888"]
  }`);

  assert.equal(config.enabled, true);
  assert.equal(config.logChannelId, "111111111111111111");
  assert.deepEqual(config.trustedRoleIds, ["222222222222222222"]);
  assert.deepEqual(config.honeypot.channelIds, ["333333333333333333"]);
  assert.equal(config.honeypot.quarantineRoleId, "444444444444444444");
  assert.equal(config.honeypot.deleteTriggerMessage, true);
  assert.equal(config.labyrinth.entryRoleId, "555555555555555555");
  assert.deepEqual(config.labyrinth.verifiedRoleIds, ["666666666666666666"]);
  if (!config.welcome) {
    assert.fail("welcome config should be parsed");
  }
  assert.equal(config.welcome.channelId, "777777777777777777");
  assert.equal(config.welcome.message, "Statement: Welcome, $mention. Proceed through the labyrinth.");
  assert.deepEqual(config.autoroles, ["888888888888888888"]);
});

void test("parseGuardConfigJson fails closed for invalid honeypot snowflakes", () => {
  assert.throws(
    () =>
      parseGuardConfigJson(`{
        "honeypot": {
          "channelIds": ["not-a-channel"],
          "quarantineRoleId": "444444444444444444"
        }
      }`),
    /honeypot.channelIds/,
  );
});

void test("parseGuardConfigJson defaults to disabled safe settings", () => {
  const config = parseGuardConfigJson(`{}`);

  assert.equal(config.enabled, false);
  assert.equal(config.logChannelId, undefined);
  assert.deepEqual(config.trustedRoleIds, []);
  assert.deepEqual(config.honeypot.channelIds, []);
  assert.equal(config.honeypot.quarantineRoleId, undefined);
  assert.equal(config.honeypot.deleteTriggerMessage, false);
  assert.equal(config.labyrinth.entryRoleId, undefined);
  assert.deepEqual(config.labyrinth.verifiedRoleIds, []);
  assert.equal(config.welcome, undefined);
  assert.deepEqual(config.autoroles, []);
});
