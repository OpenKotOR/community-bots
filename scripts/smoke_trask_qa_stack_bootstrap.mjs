#!/usr/bin/env node
/**
 * Smoke: CI-parity env + indexer/Worker bootstrap + stack health (no LLM, no Playwright).
 */
import { spawnSync } from "node:child_process";

import { loadEnvFiles, repoRoot } from "./lib/trask-env.mjs";
import { bootstrapTraskIndexedStack } from "./lib/trask_qa_stack_bootstrap.mjs";

loadEnvFiles();
bootstrapTraskIndexedStack(repoRoot);

const health = spawnSync("bash", ["scripts/trask_indexed_stack_health.sh"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: process.env,
});

if (health.status !== 0) {
  process.exit(health.status ?? 1);
}

console.log("smoke_trask_qa_stack_bootstrap: OK");
