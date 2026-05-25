/**
 * CI-parity env + indexer/Worker bootstrap for live Trask QA.
 * Consumers: holocron-e2e-webserver.mjs, verify_trask_cli_qa.mjs, verify_trask_discord_live.mjs.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * @param {string} repoRoot
 */
export function applyTraskQaStackEnv(repoRoot) {
  process.env.TRASK_INDEXER_BASE_URL ??= "http://127.0.0.1:8787";
  process.env.TRASK_QA_GROUNDING ??= "1";
  process.env.TRASK_LLM_PROFILE ??= "free";
  process.env.TRASK_WEB_RESEARCH_DDG_FALLBACK ??= "0";
  process.env.TRASK_RESEARCH_COMPOSE_MODE ??= "grounded";
  process.env.TRASK_WEB_RESEARCH_PYTHON ??=
    process.env.TRASK_WEB_RESEARCH_PYTHON ?? resolve(repoRoot, ".venv-trask-indexer/bin/python");
}

/**
 * @param {string} repoRoot
 */
export function bootstrapTraskIndexedStack(repoRoot) {
  applyTraskQaStackEnv(repoRoot);
  const result = spawnSync("bash", ["scripts/ensure_trask_indexed_stack_for_e2e.sh"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
