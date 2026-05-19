import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { loadWebResearchRuntimeConfig } from "@openkotor/config";

import { createWebResearchClient } from "./web-research.js";

describe("WebResearchClient", () => {
  test("createWebResearchClient accepts runtime config", () => {
    const cfg = loadWebResearchRuntimeConfig({});
    const client = createWebResearchClient(cfg, {
      openAiApiKey: undefined,
      openAiBaseUrl: undefined,
      openAiDefaultHeaders: undefined,
      firecrawlApiKey: undefined,
      chatModel: "gpt-5.4-mini",
      chatModelFallbacks: [],
      embeddingModel: "text-embedding-3-large",
      databaseUrl: undefined,
    });
    assert.ok(client);
  });
});

describe("loadWebResearchRuntimeConfig", () => {
  test("TRASK_WEB_RESEARCH_TIMEOUT_MS overrides legacy TRASK_RESEARCHWIZARD_TIMEOUT_MS", () => {
    const cfg = loadWebResearchRuntimeConfig({
      TRASK_WEB_RESEARCH_TIMEOUT_MS: "60000",
      TRASK_RESEARCHWIZARD_TIMEOUT_MS: "900000",
    });
    assert.equal(cfg.timeoutMs, 60_000);
  });

  test("TRASK_WEB_RESEARCH_PYTHON is respected", () => {
    const cfg = loadWebResearchRuntimeConfig({ TRASK_WEB_RESEARCH_PYTHON: "/custom/python" });
    assert.equal(cfg.pythonExecutable, "/custom/python");
  });
});
