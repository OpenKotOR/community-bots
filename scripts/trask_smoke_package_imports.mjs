#!/usr/bin/env node
/**
 * Smoke-check that root scripts resolve workspace packages via devDependencies
 * (not deep dist path imports under packages). Fast gate before live verify or after pnpm install.
 */
import { loadSharedAiConfig } from "@openkotor/config";
import { traskApprovedResearchSources } from "@openkotor/retrieval";
import {
  BRIEF_DISCORD_MIN_CITATIONS,
  citationIndicesInText,
  splitResearchAnswer,
} from "@openkotor/trask";
import {
  goldenQueriesForSurface,
  loadGoldenQueries,
  loadTraskPolicy,
  verificationQueriesForSurface,
} from "@openkotor/trask-config";
import { defaultSourceCatalog } from "@openkotor/retrieval";

const assert = (ok, message) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
};

assert(goldenQueriesForSurface("cli").length >= 5, "goldenQueriesForSurface(cli)");
assert(verificationQueriesForSurface("holocron").length >= 5, "verificationQueriesForSurface(holocron)");
assert(loadGoldenQueries().length >= 5, "loadGoldenQueries");
assert(loadTraskPolicy().holocron.minHttpsSources >= 2, "loadTraskPolicy holocron.minHttpsSources");
assert(BRIEF_DISCORD_MIN_CITATIONS === 2, "BRIEF_DISCORD_MIN_CITATIONS");
const { body } = splitResearchAnswer("Answer line.\n\n## Sources\n- [1] https://example.com/foo");
assert(body.includes("Answer"), "splitResearchAnswer body");
assert(citationIndicesInText("See [1] and [2] here.").size === 2, "citationIndicesInText");
assert(traskApprovedResearchSources.length > 0, "traskApprovedResearchSources");
assert(defaultSourceCatalog.length > 0, "defaultSourceCatalog");
assert(typeof loadSharedAiConfig === "function", "loadSharedAiConfig");

console.log("trask_smoke_package_imports: OK");
