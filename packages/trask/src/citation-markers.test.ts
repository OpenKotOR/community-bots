import test from "node:test";
import assert from "node:assert/strict";

import {
  CITATION_MARKER_RE,
  collectCitationIndicesInText,
  parseCitationIndex,
} from "./citation-markers.js";

test("parseCitationIndex rejects zero and accepts positive indices", () => {
  assert.equal(parseCitationIndex("0"), null);
  assert.equal(parseCitationIndex("1"), 1);
  assert.equal(parseCitationIndex("10"), 10);
});

test("collectCitationIndicesInText ignores [0] and collects [1] and [10]", () => {
  const indices = collectCitationIndicesInText("Zero [0] one [1] ten [10]");
  assert.deepEqual([...indices].sort((a, b) => a - b), [1, 10]);
});

test("CITATION_MARKER_RE matches up to three-digit indices", () => {
  assert.ok(CITATION_MARKER_RE.test("cite [999]"));
  assert.ok(!CITATION_MARKER_RE.test("year [2024]"));
});
