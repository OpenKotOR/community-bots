import test from "node:test";
import assert from "node:assert/strict";

import type { ResearchWizardRuntimeConfig } from "@openkotor/config";

import {
  isGroundedComposeEnabled,
  isIndexMissPayload,
  isRewriteComposeEnabled,
} from "./research-compose.js";

const baseConfig = (): ResearchWizardRuntimeConfig => ({
  indexerBaseUrl: "http://127.0.0.1:8790",
  pythonExecutable: "python3",
  researchScriptPath: undefined,
  timeoutMs: 900_000,
  groundedComposeEnabled: true,
  composeMode: "grounded",
  discordSyncTimeoutMs: 600_000,
});

test("isIndexMissPayload reads index_miss from research_information", () => {
  assert.equal(
    isIndexMissPayload({
      passages: [],
      research_information: { index_miss: true },
    }),
    true,
  );
  assert.equal(
    isIndexMissPayload({
      passages: [{ quote: "x", url: "https://example.com" }],
      research_information: { index_miss: false },
    }),
    false,
  );
});

test("isIndexMissPayload treats empty passages as index miss when flag absent", () => {
  assert.equal(isIndexMissPayload({ passages: [] }), true);
});

test("isGroundedComposeEnabled respects compose mode and TRASK_GROUNDED_COMPOSE config", () => {
  assert.equal(isGroundedComposeEnabled(baseConfig()), true);
  assert.equal(
    isGroundedComposeEnabled({ ...baseConfig(), groundedComposeEnabled: false }),
    false,
  );
  assert.equal(
    isGroundedComposeEnabled({ ...baseConfig(), composeMode: "rewrite" }),
    false,
  );
});

test("isRewriteComposeEnabled is true only in rewrite mode", () => {
  assert.equal(isRewriteComposeEnabled(baseConfig()), false);
  assert.equal(isRewriteComposeEnabled({ ...baseConfig(), composeMode: "rewrite" }), true);
});
