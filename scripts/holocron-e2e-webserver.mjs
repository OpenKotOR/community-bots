#!/usr/bin/env node
/**
 * Playwright webServer entry: shared QA stack bootstrap, then trask-http Holocron.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bootstrapTraskIndexedStack } from "./lib/trask_qa_stack_bootstrap.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

process.env.TRASK_WEB_ALLOW_ANONYMOUS ??= "1";
process.env.TRASK_HTTP_PORT ??= "4010";
// Functional e2e validates UI/API path + https cite count; live URL HEAD checks run in verify:trask-discord.
process.env.TRASK_SKIP_CITATION_URL_VERIFY ??= "1";

if (process.env.HOLOCRON_E2E_FAILURE_MODE === "1") {
  process.env.TRASK_INDEXER_BASE_URL = "http://127.0.0.1:1";
  process.env.TRASK_QA_GROUNDING ??= "1";
  process.env.TRASK_WEB_RESEARCH_LOCAL_CHROMA = "0";
  process.env.TRASK_WEB_RESEARCH_DDG_FALLBACK = "0";
} else {
  bootstrapTraskIndexedStack(repoRoot);
}

const result = spawnSync("bash", ["scripts/holocron-e2e-live-server.sh"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
