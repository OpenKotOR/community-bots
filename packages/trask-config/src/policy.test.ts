import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isDegradedAnswer, loadTraskPolicy } from "./policy.js";

describe("policy", () => {
  it("loads min web citations", () => {
    const policy = loadTraskPolicy();
    assert.ok(policy.minWebCitations >= 1);
    assert.ok(policy.discord.maxBodyLines >= 1);
  });

  it("detects degraded answers", () => {
    assert.ok(isDegradedAnswer("Sorry, could not complete live web research."));
    assert.ok(!isDegradedAnswer("TSLPatcher applies 2DA patches [1]."));
  });
});
