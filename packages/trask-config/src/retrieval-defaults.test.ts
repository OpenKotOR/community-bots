import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadRetrievalDefaults } from "./retrieval-defaults.js";

describe("retrieval-defaults", () => {
  it("loads shared limits", () => {
    const defaults = loadRetrievalDefaults();
    assert.ok(defaults.maxPassages >= defaults.indexerDefaultLimit);
    assert.ok(defaults.retrieveLimit >= 1);
  });
});
