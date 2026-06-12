#!/usr/bin/env node
/**
 * Validate Hugging Face Space pack output (README frontmatter + required tree).
 * Run after pack-trask-http-hf-context.sh or standalone (packs to a temp dir).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packScript = join(root, "scripts/pack-trask-http-hf-context.sh");

const packDir =
  process.env.TRASK_HF_PACK_DIR?.trim() ||
  execFileSync("bash", [packScript], { encoding: "utf8" }).trim();

const readmePath = join(packDir, "README.md");
if (!existsSync(readmePath)) {
  console.error(`verify_trask_http_hf_pack: missing ${readmePath}`);
  process.exit(1);
}

const readme = readFileSync(readmePath, "utf8");
const frontmatterMatch = readme.match(/^---\r?\n([\s\S]*?)\r?\n---/);
if (!frontmatterMatch) {
  console.error("verify_trask_http_hf_pack: README.md missing YAML frontmatter block");
  process.exit(1);
}

const frontmatter = frontmatterMatch[1];
const sdk = frontmatter.match(/^sdk:\s*(\S+)/m)?.[1];
const appPort = frontmatter.match(/^app_port:\s*(\d+)/m)?.[1];

if (sdk !== "docker") {
  console.error(`verify_trask_http_hf_pack: README sdk must be docker (got ${sdk ?? "missing"})`);
  process.exit(1);
}
if (appPort !== "7860") {
  console.error(`verify_trask_http_hf_pack: README app_port must be 7860 (got ${appPort ?? "missing"})`);
  process.exit(1);
}

const required = [
  "Dockerfile",
  "package.json",
  "pnpm-lock.yaml",
  "apps/trask-http-server/package.json",
  "apps/holocron-web/package.json",
  "infra/trask-indexer/pyproject.toml",
  "infra/trask-http-public/docker-entrypoint.sh",
  "scripts/bootstrap_trask_research.sh",
  "scripts/trask_web_research.py",
];

for (const rel of required) {
  const path = join(packDir, rel);
  if (!existsSync(path)) {
    console.error(`verify_trask_http_hf_pack: packed tree missing ${rel}`);
    process.exit(1);
  }
}

console.log(`OK: HF pack valid at ${packDir} (sdk=docker app_port=7860)`);
