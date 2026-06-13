import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BRIEF_DISCORD_MIN_CITATIONS,
  BRIEF_DISCORD_TARGET_CITATIONS,
  briefDiscordCitationTarget,
  claimMatchesQueryAnchor,
  distinctiveAnchorTokens,
  passageMatchesQueryAnchor,
} from "./query-anchor.js";

describe("BRIEF_DISCORD_MIN_CITATIONS", () => {
  test("is 2 for brief Discord sufficiency", () => {
    assert.equal(BRIEF_DISCORD_MIN_CITATIONS, 2);
  });

  test("targets richer answers when enough evidence exists", () => {
    assert.equal(BRIEF_DISCORD_TARGET_CITATIONS, 3);
  });

  test("requires the richer target only when enough citations are available", () => {
    assert.equal(briefDiscordCitationTarget(1), 2);
    assert.equal(briefDiscordCitationTarget(2), 2);
    assert.equal(briefDiscordCitationTarget(3), 3);
    assert.equal(briefDiscordCitationTarget(8), 3);
  });
});

describe("distinctiveAnchorTokens", () => {
  test("prefers intent vocabulary for tooling queries", () => {
    const tokens = distinctiveAnchorTokens("What is TSLPatcher used for in KOTOR modding?");
    assert.ok(tokens.some((t) => t.includes("tslpatcher") || t === "tslpatcher"));
  });

  test("falls back to longest query token when no distinctive match", () => {
    const tokens = distinctiveAnchorTokens("how to fix it");
    assert.ok(tokens.length >= 1);
  });
});

describe("claimMatchesQueryAnchor", () => {
  test("matches when claim mentions distinctive token", () => {
    assert.ok(
      claimMatchesQueryAnchor(
        {
          claim: "TSLPatcher applies 2DA patches for KotOR mods.",
          quote: "TSLPatcher applies 2DA patches.",
        },
        "What is TSLPatcher used for?",
      ),
    );
  });

  test("rejects unrelated claim text", () => {
    assert.equal(
      claimMatchesQueryAnchor(
        { claim: "MDLOps converts models.", quote: "MDLOps converts models." },
        "What is TSLPatcher used for?",
      ),
      false,
    );
  });
});

describe("passageMatchesQueryAnchor", () => {
  test("matches passage text containing anchor token", () => {
    assert.ok(
      passageMatchesQueryAnchor(
        { text: "reone provides Odyssey engine tooling for developers." },
        "What does the reone project provide?",
      ),
    );
  });
});
