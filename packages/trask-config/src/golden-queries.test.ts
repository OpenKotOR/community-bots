import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getGoldenQuery, loadGoldenQueries } from "./golden-queries.js";

describe("golden-queries", () => {
  it("loads five canonical queries", () => {
    const queries = loadGoldenQueries();
    assert.equal(queries.length, 5);
    assert.ok(queries.every((entry) => entry.expectRe instanceof RegExp));
  });

  it("resolves tslpatcher by id", () => {
    const entry = getGoldenQuery("tslpatcher");
    assert.ok(entry);
    assert.match(entry.question, /TSLPatcher/i);
    assert.match("TSLPatcher applies 2DA patches", entry.expectRe);
  });

  it("unifies MDLOps canonical wording", () => {
    const entry = getGoldenQuery("mdlops");
    assert.ok(entry);
    assert.equal(entry.question, "What is MDLOps used for in the KOTOR toolchain?");
  });
});
