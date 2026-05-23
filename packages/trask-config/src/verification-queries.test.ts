import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadVerificationQueries, verificationQueriesForSurface } from "./verification-queries.js";

describe("verification-queries", () => {
  it("loads five expert verification queries", () => {
    const queries = loadVerificationQueries();
    assert.equal(queries.length, 5);
    assert.ok(queries.every((entry) => entry.expectRe instanceof RegExp));
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
