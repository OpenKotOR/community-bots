#!/usr/bin/env node
/**
 * Fail CI when golden query strings or catalog source ids drift outside approved locations.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defaultSourceCatalog } from "../packages/retrieval/dist/index.js";
import { goldenFixtures, loadGoldenQueries } from "../packages/trask-config/dist/golden-queries.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogIds = new Set(defaultSourceCatalog.map((source) => source.id));

const ALLOWED_GOLDEN_LITERAL_PATHS = new Set([
  "data/trask/eval/golden-queries.json",
  "data/trask/eval/verification-queries.json",
  "data/trask-eval/golden-queries.json",
  "data/trask-eval/fixtures",
  "data/trask-http-server",
  "apps/trask-http-server/data",
  "docs/knowledgebase",
  "docs/plans",
  "docs/brainstorms",
  "docs/evidence",
  "docs/trask-ops.md",
  "AGENTS.md",
  "apps/holocron-web/e2e",
  "packages/trask/src",
  "infra/trask-retrieve-worker",
  ".cursor/plans",
]);

const shouldScanFile = (relPath) => {
  if (relPath.includes("node_modules/")) return false;
  if (relPath.includes("/dist/")) return false;
  if (relPath.startsWith(".cursor/")) return false;
  if (relPath.includes("agent-transcripts/")) return false;
  if (relPath.endsWith(".png") || relPath.endsWith(".webm")) return false;
  if (relPath.endsWith(".lock") || relPath.endsWith(".snap")) return false;
  if (relPath.startsWith("packages/trask-config/src/")) return false;
  if (relPath === "scripts/check_trask_config_drift.mjs") return false;
  return (
    relPath.endsWith(".ts")
    || relPath.endsWith(".tsx")
    || relPath.endsWith(".js")
    || relPath.endsWith(".mjs")
    || relPath.endsWith(".py")
    || relPath.endsWith(".md")
    || relPath.endsWith(".json")
  );
};

const walk = (dir, base = "") => {
  const entries = [];
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${name.name}` : name.name;
    const abs = join(dir, name.name);
    if (name.isDirectory()) {
      entries.push(...walk(abs, rel));
    } else if (shouldScanFile(rel)) {
      entries.push(rel);
    }
  }
  return entries;
};

const isAllowedGoldenLiteral = (relPath) => {
  for (const allowed of ALLOWED_GOLDEN_LITERAL_PATHS) {
    if (relPath === allowed || relPath.startsWith(`${allowed}/`)) return true;
  }
  return false;
};

const errors = [];

for (const fixture of goldenFixtures()) {
  if (!catalogIds.has(fixture.sourceId)) {
    errors.push(`golden fixture ${fixture.id} uses sourceId "${fixture.sourceId}" not in catalog`);
  }
}

const goldenQuestions = loadGoldenQueries().map((entry) => entry.question);
for (const relPath of walk(repoRoot)) {
  if (isAllowedGoldenLiteral(relPath)) continue;
  const text = readFileSync(join(repoRoot, relPath), "utf8");
  for (const question of goldenQuestions) {
    if (text.includes(question)) {
      errors.push(`golden question duplicated in ${relPath}`);
    }
  }
}

if (errors.length > 0) {
  console.error("Trask config drift check failed:\n");
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log("Trask config drift check passed.");
