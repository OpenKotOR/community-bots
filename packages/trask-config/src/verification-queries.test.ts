import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getGoldenQuery } from "./golden-queries.js";
import { loadVerificationQueries, verificationQueriesForSurface } from "./verification-queries.js";

describe("verification-queries", () => {
  it("loads five expert verification queries", () => {
    const queries = loadVerificationQueries();
    assert.equal(queries.length, 5);
    assert.ok(queries.every((entry) => entry.expectRe instanceof RegExp));
  });

  it("links discord verification queries to golden fixture pairs", () => {
    const discord = verificationQueriesForSurface("discord");
    assert.equal(discord.length, 5);
    for (const entry of discord) {
      const golden = getGoldenQuery(entry.goldenQueryId);
      assert.ok(golden?.fixture, `${entry.id} goldenQueryId fixture`);
      assert.ok(golden?.companionFixture, `${entry.id} goldenQueryId companionFixture`);
    }
  });

  it("excludes golden literal wording for holocron surface", () => {
    const holocron = verificationQueriesForSurface("holocron");
    assert.ok(holocron.length >= 5);
    assert.ok(
      holocron.every((entry) => !/^What is TSLPatcher used for in KOTOR modding\?$/i.test(entry.question)),
      "verification set should not repeat the easy golden TSLPatcher question",
    );
  });
});
