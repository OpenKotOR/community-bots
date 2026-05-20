import test from "node:test";
import assert from "node:assert/strict";

import type { SourceDescriptor } from "@openkotor/retrieval";

import { splitResearchAnswer } from "./discord-reply-format.js";
import {
  collectCitedSourcesFromAnswer,
  collectCitationIndicesFromAnswer,
  composeGroundedAnswerFromClaims,
  claimsFromDistinctPassages,
  extractClaimsHeuristic,
  hasMinimumDiscordBriefGroundedSupport,
  hasMinimumGroundedSupport,
  selectDistinctBriefClaims,
  inferGroundingStatus,
  passagesFromRetrieveRows,
  splitReportIntoPassages,
} from "./grounded-evidence.js";
import { _collectCitedSourcesFromText } from "./research-wizard.js";

const sources: SourceDescriptor[] = [
  {
    id: "a",
    name: "Deadly Stream",
    kind: "website",
    homeUrl: "https://deadlystream.com/topic/1",
    description: "",
    freshnessPolicy: "",
    approvalScope: "",
    tags: [],
  },
  {
    id: "b",
    name: "KOTOR Neocities",
    kind: "website",
    homeUrl: "https://kotor.neocities.org/modding/tslpatcher/",
    description: "",
    freshnessPolicy: "",
    approvalScope: "",
    tags: [],
  },
];

test("collectCitationIndicesFromAnswer reads body markers only", () => {
  const answer = "TSLPatcher edits 2DA tables [1] and GFF nodes [2].\n\nSources\n1. Deadly Stream - https://deadlystream.com/topic/1\n2. KOTOR - https://kotor.neocities.org/modding/tslpatcher/";
  assert.deepEqual(collectCitationIndicesFromAnswer(answer), [1, 2]);
});

test("collectCitedSourcesFromAnswer aligns sources to cited indices", () => {
  const answer = "TSLPatcher applies patches [1][2].\n\nSources\n1. Deadly Stream - https://deadlystream.com/topic/1\n2. KOTOR - https://kotor.neocities.org/modding/tslpatcher/";
  const aligned = collectCitedSourcesFromAnswer(answer, sources, _collectCitedSourcesFromText);
  assert.equal(aligned.length, 2);
  assert.equal(aligned[0]?.homeUrl, sources[0]?.homeUrl);
});

test("extractClaimsHeuristic finds multi-url claims", () => {
  const report = [
    "TSLPatcher is used for KotOR modding to apply 2DA, GFF, and TLK patches. https://deadlystream.com/topic/1",
    "TSLPatcher installers are documented for KotOR modding workflows. https://kotor.neocities.org/modding/tslpatcher/",
  ].join("\n\n");
  const claims = extractClaimsHeuristic("What is TSLPatcher used for?", splitReportIntoPassages(report));
  assert.ok(claims.length >= 1, "expected at least one heuristic claim");
  assert.ok(
    hasMinimumGroundedSupport(claims),
    "expected claims from two distinct https URLs",
  );
});

test("composeGroundedAnswerFromClaims emits Sources for cited indices", () => {
  const claims = [
    {
      claim: "TSLPatcher edits 2DA files",
      quote: "TSLPatcher edits 2DA files for installation.",
      url: sources[0]!.homeUrl,
      citationUrl: sources[0]!.homeUrl,
      sourceIndex: 1,
      authority: "web" as const,
    },
    {
      claim: "TSLPatcher also patches GFF resources",
      quote: "TSLPatcher also patches GFF resources during install.",
      url: sources[1]!.homeUrl,
      citationUrl: sources[1]!.homeUrl,
      sourceIndex: 2,
      authority: "web" as const,
    },
  ];
  const answer = composeGroundedAnswerFromClaims("What is TSLPatcher?", claims, sources);
  assert.match(answer, /\[1\]/);
  assert.match(answer, /\[2\]/);
  assert.match(answer, /\nSources\n/);
});

test("composeGroundedAnswerFromClaims brief profile emits two citation lines", () => {
  const claims = [
    {
      claim: "TSLPatcher applies 2DA patches.",
      quote: "TSLPatcher applies 2DA patches.",
      url: sources[0]!.homeUrl,
      citationUrl: sources[0]!.homeUrl,
      sourceIndex: 1,
      authority: "web" as const,
    },
    {
      claim: "GFF and TLK are also patched.",
      quote: "GFF and TLK are also patched.",
      url: sources[1]!.homeUrl,
      citationUrl: sources[1]!.homeUrl,
      sourceIndex: 2,
      authority: "web" as const,
    },
  ];
  const answer = composeGroundedAnswerFromClaims(
    "When a KotOR mod ships 2DA and TLK changes, what does TSLPatcher automate?",
    claims,
    sources,
    "brief",
  );
  const { body } = splitResearchAnswer(answer);
  const lines = body.split(/\r?\n/).filter((line) => line.trim().length > 0);
  assert.equal(lines.length, 2);
  assert.match(answer, /\[1\]/);
  assert.match(answer, /\[2\]/);
});

test("passagesFromRetrieveRows maps structured retrieve hits", () => {
  const passages = passagesFromRetrieveRows([
    { quote: "TSLPatcher applies 2DA patches for KotOR modding.", url: "https://deadlystream.com/topic/1" },
    { quote: "Use HoloPatcher for installs in 2024.", url: "discord://channels/1/2-3" },
  ]);
  assert.equal(passages.length, 2);
  assert.equal(passages[1]?.authority, "discord");
});

test("hasMinimumGroundedSupport accepts one web and one discord passage", () => {
  const claims = [
    {
      claim: "Web fact",
      quote: "Web fact quote.",
      url: "https://deadlystream.com/topic/1",
      citationUrl: "https://deadlystream.com/topic/1",
      sourceIndex: 1,
      authority: "web" as const,
    },
    {
      claim: "Discord fact",
      quote: "Discord fact quote.",
      url: "discord://channels/1/2-3",
      citationUrl: "https://discord.com/channels/111/222/333",
      sourceIndex: 2,
      authority: "discord" as const,
    },
  ];
  assert.equal(hasMinimumGroundedSupport(claims), true);
  assert.equal(hasMinimumDiscordBriefGroundedSupport(claims, "Web fact"), true);
});

test("claimsFromDistinctPassages keeps two distinct save URLs when only one is anchored", () => {
  const passages = [
    {
      text: "# KOTOR save game location\n\nSave games on Windows are stored under Documents in a KOTOR Saves folder.",
      url: "https://deadlystream.com/topic/5844-kotor-save-game-location/",
      host: "deadlystream.com",
      authority: "web" as const,
    },
    {
      text: "# Save file paths\n\nKOTOR save files on Windows live under the user Documents Saves directory.",
      url: "https://steamcommunity.com/sharedfiles/filedetails/?id=128193866",
      host: "steamcommunity.com",
      authority: "web" as const,
    },
  ];
  const claims = claimsFromDistinctPassages(
    passages,
    4,
    "Where does Knights of the Old Republic store saves on Windows?",
  );
  assert.equal(claims.length, 2);
  assert.equal(new Set(claims.map((c) => c.url)).size, 2);
});

test("claimsFromDistinctPassages prefers query-anchored passages", () => {
  const passages = [
    {
      text: "# reone\n\nOpen-source Odyssey engine reimplementation.",
      url: "https://github.com/reone/reone",
      host: "github.com",
      authority: "web" as const,
    },
    {
      text: "# TSLPatcher\n\nApplies 2DA, GFF, and TLK patches for KotOR mods.",
      url: "https://kotor.neocities.org/modding/tslpatcher/",
      host: "kotor.neocities.org",
      authority: "web" as const,
    },
  ];
  const claims = claimsFromDistinctPassages(passages, 3, "What is TSLPatcher used for in KOTOR modding?");
  assert.equal(claims.length, 1);
  assert.match(claims[0]?.claim ?? "", /TSLPatcher/i);
  assert.equal(
    hasMinimumDiscordBriefGroundedSupport(claims, "What is TSLPatcher used for in KOTOR modding?"),
    false,
  );
});

test("selectDistinctBriefClaims requires two distinct citation URLs", () => {
  const claims = [
    {
      claim: "First",
      quote: "First quote",
      url: sources[0]!.homeUrl,
      citationUrl: sources[0]!.homeUrl,
      sourceIndex: 1,
      authority: "web" as const,
    },
    {
      claim: "Second",
      quote: "Second quote",
      url: sources[1]!.homeUrl,
      citationUrl: sources[1]!.homeUrl,
      sourceIndex: 2,
      authority: "web" as const,
    },
  ];
  const picked = selectDistinctBriefClaims(claims, "TSLPatcher modding", 2);
  assert.equal(picked.length, 2);
});

test("composeGroundedAnswerFromClaims full profile keeps only query-anchored claims", () => {
  const claims = [
    {
      claim: "# MDLOps\n\nMDLOps converts models.",
      quote: "MDLOps converts models.",
      url: "https://deadlystream.com/topic/mdlops/",
      citationUrl: "https://deadlystream.com/topic/mdlops/",
      sourceIndex: 1,
      authority: "web" as const,
    },
    {
      claim: "# TSLPatcher\n\nApplies 2DA and GFF patches.",
      quote: "Applies 2DA and GFF patches.",
      url: "https://kotor.neocities.org/modding/tslpatcher/",
      citationUrl: "https://kotor.neocities.org/modding/tslpatcher/",
      sourceIndex: 2,
      authority: "web" as const,
    },
  ];
  const answer = composeGroundedAnswerFromClaims(
    "What is TSLPatcher used for in KOTOR modding?",
    claims,
    sources,
    "full",
  );
  assert.match(answer, /TSLPatcher/i);
  assert.doesNotMatch(answer, /MDLOps/i);
});

test("passagesFromRetrieveRows preserves verified flag", () => {
  const passages = passagesFromRetrieveRows([
    {
      quote: "TSLPatcher applies 2DA patches.",
      url: "https://deadlystream.com/files/file/1982-tslpatcher/",
      verified: true,
    },
  ]);
  assert.equal(passages.length, 1);
  assert.equal(passages[0]?.verified, true);
});

test("inferGroundingStatus marks partial abstention", () => {
  const answer = "I found candidate sources for TSLPatcher, but I could not support a grounded answer from the retrieved evidence.";
  assert.equal(inferGroundingStatus(answer, 2), "partial");
});

test("inferGroundingStatus returns grounded with enough citations", () => {
  const answer = "TSLPatcher applies 2DA and TLK patches [1] and GFF edits [2].";
  assert.equal(inferGroundingStatus(answer, 2), "grounded");
});

test("inferGroundingStatus returns failed when citations are thin", () => {
  const answer = "TSLPatcher applies patches [1].";
  assert.equal(inferGroundingStatus(answer, 1), "failed");
});

test("inferGroundingStatus returns failed for live research failure prefix", () => {
  const answer = "I could not complete live web research for this question right now.";
  assert.equal(inferGroundingStatus(answer, 0), "failed");
});
