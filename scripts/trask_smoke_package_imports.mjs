#!/usr/bin/env node
/**
 * Smoke-check that root scripts resolve workspace packages via devDependencies
 * (not deep dist path imports under packages). Fast gate before live verify or after pnpm install.
 */
import { loadSharedAiConfig } from "@openkotor/config";
import { defaultSourceCatalog, traskApprovedResearchSources } from "@openkotor/retrieval";
import {
  BRIEF_DISCORD_MIN_CITATIONS,
  citationIndicesInText,
  splitResearchAnswer,
} from "@openkotor/trask";
import {
  getGoldenQuery,
  goldenFixtures,
  goldenQueriesForSurface,
  loadGoldenQueries,
  loadTraskPolicy,
  loadVerificationQueries,
  verificationQueriesForSurface,
} from "@openkotor/trask-config";
import {
  composeGoldenCliAnswer,
  DISCORD_IMPORT_SMOKE_SPECS,
  GOLDEN_IMPORT_SMOKE_IDS,
} from "./lib/compose_golden_cli_answer.mjs";
import {
  assertProvenanceFooter,
  defaultIndexerUrlForSmoke,
} from "./lib/discord_provenance_footer.mjs";
import { assertAe3ResearchTraceFailureClasses } from "./lib/trask_research_trace_assert.mjs";

const assert = (ok, message) => {
  if (!ok) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
};

assert(goldenQueriesForSurface("cli").length >= 5, "goldenQueriesForSurface(cli)");
assert(verificationQueriesForSurface("holocron").length >= 5, "verificationQueriesForSurface(holocron)");
assert(loadGoldenQueries().length >= 5, "loadGoldenQueries");
assert(getGoldenQuery("tslpatcher")?.companionFixture?.host === "github.com", "getGoldenQuery companionFixture");
assert(goldenFixtures().length === 10, "goldenFixtures primary+companion");
assert(loadTraskPolicy().holocron.minHttpsSources >= 2, "loadTraskPolicy holocron.minHttpsSources");
assert(BRIEF_DISCORD_MIN_CITATIONS === 2, "BRIEF_DISCORD_MIN_CITATIONS");
const { body } = splitResearchAnswer("Answer line.\n\n## Sources\n- [1] https://example.com/foo");
assert(body.includes("Answer"), "splitResearchAnswer body");
assert(citationIndicesInText("See [1] and [2] here.").size === 2, "citationIndicesInText");
assert(traskApprovedResearchSources.length > 0, "traskApprovedResearchSources");
assert(defaultSourceCatalog.length > 0, "defaultSourceCatalog");
assert(typeof loadSharedAiConfig === "function", "loadSharedAiConfig");

assert(GOLDEN_IMPORT_SMOKE_IDS.length === 5, "GOLDEN_IMPORT_SMOKE_IDS canonical five");
for (const goldenId of GOLDEN_IMPORT_SMOKE_IDS) {
  const smoke = composeGoldenCliAnswer(goldenId);
  assert(smoke.approvedSources.length === 2, `composeGoldenCliAnswer(${goldenId}) approvedSources`);
  assert(smoke.answer.includes("[1]") && smoke.answer.includes("[2]"), `composeGoldenCliAnswer(${goldenId}) citations`);
  assert(/\nSources\n/i.test(smoke.answer), `composeGoldenCliAnswer(${goldenId}) Sources block`);
}

assert(DISCORD_IMPORT_SMOKE_SPECS.length === 5, "DISCORD_IMPORT_SMOKE_SPECS canonical five");
const verificationById = new Map(loadVerificationQueries().map((entry) => [entry.id, entry]));
for (const spec of DISCORD_IMPORT_SMOKE_SPECS) {
  const verification = verificationById.get(spec.verificationId);
  assert(verification, `verification query ${spec.verificationId}`);
  const smoke = composeGoldenCliAnswer(spec.goldenId, { question: verification.question });
  assert(smoke.approvedSources.length === 2, `discord compose(${spec.goldenId}) approvedSources`);
  assert(smoke.answer.includes("[1]") && smoke.answer.includes("[2]"), `discord compose(${spec.goldenId}) citations`);
  assert(/\nSources\n/i.test(smoke.answer), `discord compose(${spec.goldenId}) Sources block`);
  const footerAudit = assertProvenanceFooter({
    passagesCount: Math.max(smoke.approvedSources.length, 2),
    indexerUrl: defaultIndexerUrlForSmoke(),
  });
  assert(
    typeof footerAudit !== "string",
    `discord compose(${spec.goldenId}) provenance footer: ${footerAudit}`,
  );
}

assertAe3ResearchTraceFailureClasses();

console.log("trask_smoke_package_imports: OK");
