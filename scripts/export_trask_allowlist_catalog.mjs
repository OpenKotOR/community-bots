#!/usr/bin/env node
/**
 * Export Trask approved research catalog for the Python indexer.
 * Requires: pnpm --filter @openkotor/retrieval build
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  traskApprovedResearchBaseHosts,
  traskApprovedResearchSources,
  traskApprovedResearchUrlPrefixes,
} from "../packages/retrieval/dist/index.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(repoRoot, "data", "trask-indexer");
const outPath = join(outDir, "allowlist.json");

const payload = {
  baseHosts: [...traskApprovedResearchBaseHosts],
  urlPrefixes: [...traskApprovedResearchUrlPrefixes],
  sources: traskApprovedResearchSources.map((s) => ({
    id: s.id,
    homeUrl: s.homeUrl,
    name: s.name,
  })),
};

mkdirSync(outDir, { recursive: true });
writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`Wrote ${outPath} (${payload.sources.length} sources)`);
