import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeDiscordOutput, truncateDiscordOutput } from "./hk-dialog-client.js";

void test("sanitizeDiscordOutput disables mass mentions and trims whitespace", () => {
  assert.equal(sanitizeDiscordOutput("  Statement: hello @everyone and @here.  "), "Statement: hello @\u200beveryone and @\u200bhere.");
});

void test("truncateDiscordOutput preserves short text", () => {
  assert.equal(truncateDiscordOutput("Statement: concise.", 50), "Statement: concise.");
});

void test("truncateDiscordOutput trims at limit with ellipsis", () => {
  assert.equal(truncateDiscordOutput("Statement: " + "x".repeat(40), 20), "Statement: xxxxxx...");
});
