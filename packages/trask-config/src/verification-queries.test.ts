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

  const assertGoldenQueryLinks = (surface: string) => {
    const rows = verificationQueriesForSurface(surface);
    assert.equal(rows.length, 5, `${surface} verification count`);
    for (const entry of rows) {
      const golden = getGoldenQuery(entry.goldenQueryId);
      assert.ok(golden?.fixture, `${entry.id} goldenQueryId fixture`);
      assert.ok(golden?.companionFixture, `${entry.id} goldenQueryId companionFixture`);
    }
  };

  it("links discord verification queries to golden fixture pairs", () => {
    assertGoldenQueryLinks("discord");
  });

  it("links holocron verification queries to golden fixture pairs", () => {
    assertGoldenQueryLinks("holocron");
  });

  it("uses unique goldenQueryId values across verification queries", () => {
    const ids = loadVerificationQueries().map((entry) => entry.goldenQueryId);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(ids.length, 5);
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
