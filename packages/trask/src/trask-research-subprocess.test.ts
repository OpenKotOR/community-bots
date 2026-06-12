import test from "node:test";
import assert from "node:assert/strict";

import { parseTraskWebResearchStdout } from "./trask-research-subprocess.js";

test("parseTraskWebResearchStdout accepts clean JSON", () => {
  const parsed = parseTraskWebResearchStdout(
    JSON.stringify({
      report: "Cited answer.",
      passages: [],
      research_information: {},
    }),
  );

  assert.equal(parsed.report, "Cited answer.");
});

test("parseTraskWebResearchStdout extracts a valid JSON object from noisy stdout", () => {
  const parsed = parseTraskWebResearchStdout(
    [
      "provider warning on stdout",
      JSON.stringify({
        report: "Grounded answer.",
        passages: [{ quote: "quote", url: "https://example.com" }],
        research_information: { passages_count: 1 },
      }),
      "trailing note",
    ].join("\n"),
  );

  assert.equal(parsed.report, "Grounded answer.");
  assert.equal(parsed.passages?.length, 1);
});

test("parseTraskWebResearchStdout rejects non-JSON stdout", () => {
  assert.throws(
    () => parseTraskWebResearchStdout("Cited: 0 · Consulted: 0 · Status: failed"),
    SyntaxError,
  );
});
