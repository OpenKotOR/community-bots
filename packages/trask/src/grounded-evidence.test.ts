import test from "node:test";
import assert from "node:assert/strict";

import type { SourceDescriptor } from "@openkotor/retrieval";

import {
  collectCitedSourcesFromAnswer,
  collectCitationIndicesFromAnswer,
  composeGroundedAnswerFromClaims,
  extractClaimsHeuristic,
  hasMinimumGroundedSupport,
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
      sourceIndex: 1,
      authority: "web" as const,
    },
    {
      claim: "It also patches GFF resources",
      quote: "It also patches GFF resources during install.",
      url: sources[1]!.homeUrl,
      sourceIndex: 2,
      authority: "web" as const,
    },
  ];
  const answer = composeGroundedAnswerFromClaims("What is TSLPatcher?", claims, sources);
  assert.match(answer, /\[1\]/);
  assert.match(answer, /\[2\]/);
  assert.match(answer, /\nSources\n/);
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
      sourceIndex: 1,
      authority: "web" as const,
    },
    {
      claim: "Discord fact",
      quote: "Discord fact quote.",
      url: "discord://channels/1/2-3",
      sourceIndex: 2,
      authority: "discord" as const,
    },
  ];
  assert.equal(hasMinimumGroundedSupport(claims), true);
});

test("inferGroundingStatus marks partial abstention", () => {
  const answer = "I found candidate sources for TSLPatcher, but I could not support a grounded answer from the retrieved evidence.";
  assert.equal(inferGroundingStatus(answer, 2), "partial");
});
