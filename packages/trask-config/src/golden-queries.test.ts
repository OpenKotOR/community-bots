import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getGoldenQuery, goldenFixtures, loadGoldenQueries } from "./golden-queries.js";

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

  it("preserves companionFixture on tslpatcher", () => {
    const entry = getGoldenQuery("tslpatcher");
    assert.ok(entry?.companionFixture);
    assert.equal(entry.companionFixture.host, "github.com");
    assert.ok(entry.fixture);
  });

  it("goldenFixtures includes primary and companion rows", () => {
    const fixtures = goldenFixtures();
    assert.equal(fixtures.length, 10);
    assert.equal(fixtures.filter((row) => row.role === "primary").length, 5);
    assert.equal(fixtures.filter((row) => row.role === "companion").length, 5);
    assert.ok(fixtures.some((row) => row.id === "tslpatcher:companion"));
  });
});
