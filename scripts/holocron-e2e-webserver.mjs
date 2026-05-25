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

bootstrapTraskIndexedStack(repoRoot);

const result = spawnSync("bash", ["scripts/holocron-e2e-live-server.sh"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
