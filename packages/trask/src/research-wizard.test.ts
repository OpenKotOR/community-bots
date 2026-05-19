import test from "node:test";
import assert from "node:assert/strict";

import {
  _normalizeUrl,
  _extractUrls,
  _collectCitedSources,
  _collectCitedSourcesFromText,
  _collectRetrievedSources,
  _collectVisitedUrlsFromPayload,
  _hostnameHint,
  _uniqueUrlsPreserveOrder,
  _isSynthesisFailureReport,
  _countPayloadWebUrls,
  _normalizeReport,
  _formatSourcesSection,
  _normalizePreferredRewriteModel,
  _matchApprovedSource,
  _classifyQueryIntent,
  _routeSourcesForQuery,
  _alignCitedSourcesToAnswer,
} from "./research-wizard.js";
import type { SourceDescriptor } from "../../retrieval/src/index.js";

// ---------------------------------------------------------------------------
// _normalizeUrl
// ---------------------------------------------------------------------------

test("_normalizeUrl removes trailing slashes", () => {
  assert.equal(_normalizeUrl("https://example.com/"), "https://example.com");
  assert.equal(_normalizeUrl("https://example.com///"), "https://example.com");
});

test("_normalizeUrl trims whitespace", () => {
  assert.equal(_normalizeUrl("  https://example.com  "), "https://example.com");
});

test("_normalizeUrl preserves URL path when no trailing slash", () => {
  assert.equal(_normalizeUrl("https://example.com/path"), "https://example.com/path");
});

// ---------------------------------------------------------------------------
// _extractUrls
// ---------------------------------------------------------------------------

test("_extractUrls extracts HTTP and HTTPS URLs from text", () => {
  const text = "See https://example.com and http://other.org for more.";
  const urls = _extractUrls(text);
  assert.ok(urls.includes("https://example.com"));
  assert.ok(urls.includes("http://other.org"));
});

test("_extractUrls strips trailing punctuation from URLs", () => {
  const urls = _extractUrls("Visit https://example.com. And https://other.com!");
  assert.ok(urls.includes("https://example.com"));
  assert.ok(urls.includes("https://other.com"));
  assert.ok(!urls.some((u) => u.endsWith(".")));
});

test("_extractUrls deduplicates URLs", () => {
  const urls = _extractUrls("https://example.com and https://example.com again");
  assert.equal(urls.filter((u) => u === "https://example.com").length, 1);
});

test("_extractUrls returns empty array when no URLs are present", () => {
  assert.deepEqual(_extractUrls("no urls here"), []);
});

// ---------------------------------------------------------------------------
// _hostnameHint
// ---------------------------------------------------------------------------

test("_hostnameHint returns the hostname without www prefix", () => {
  assert.equal(_hostnameHint("https://www.swtor.com/info"), "swtor.com");
});

test("_hostnameHint returns just the hostname for bare origins", () => {
  assert.equal(_hostnameHint("https://kotor.fandom.com"), "kotor.fandom.com");
});

test("_hostnameHint falls back gracefully for invalid URLs", () => {
  const result = _hostnameHint("not-a-url");
  assert.ok(typeof result === "string");
  assert.ok(result.length <= 48);
});

// ---------------------------------------------------------------------------
// _uniqueUrlsPreserveOrder
// ---------------------------------------------------------------------------

test("_uniqueUrlsPreserveOrder returns unique URLs in first-seen order", () => {
  const result = _uniqueUrlsPreserveOrder([
    "https://a.com/",
    "https://b.com",
    "https://a.com",  // duplicate of first (after normalization)
    "https://c.com",
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[0], "https://a.com");
  assert.equal(result[1], "https://b.com");
  assert.equal(result[2], "https://c.com");
});

test("_uniqueUrlsPreserveOrder filters empty strings", () => {
  const result = _uniqueUrlsPreserveOrder(["", "https://example.com", ""]);
  assert.equal(result.length, 1);
  assert.equal(result[0], "https://example.com");
});

// ---------------------------------------------------------------------------
// _isSynthesisFailureReport
// ---------------------------------------------------------------------------

const emptyPayload = { report: "" };

test("_isSynthesisFailureReport returns true for the Python synthesis-failure message", () => {
  assert.equal(
    _isSynthesisFailureReport("I could not complete live archive synthesis for this question right now.", emptyPayload),
    true,
  );
});

test("_isSynthesisFailureReport is case-insensitive for synthesis failure", () => {
  assert.equal(
    _isSynthesisFailureReport("I COULD NOT COMPLETE LIVE ARCHIVE SYNTHESIS FOR THIS QUESTION RIGHT NOW", emptyPayload),
    true,
  );
});

test("_isSynthesisFailureReport treats stub bullets as failure when payload has few URLs", () => {
  assert.equal(
    _isSynthesisFailureReport(
      "- https://example.com is an approved archive page that may answer questions about something",
      emptyPayload,
    ),
    true,
  );
});

test("_isSynthesisFailureReport allows stub report when payload has enough web URLs", () => {
  const payload = {
    report: "",
    research_information: {
      cited_urls: ["https://deadlystream.com/topic/1", "https://github.com/seedhartha/reone"],
    },
  };
  assert.equal(
    _isSynthesisFailureReport(
      "- https://deadlystream.com is an approved archive page that may answer questions about mdlops",
      payload,
    ),
    false,
  );
  assert.equal(_countPayloadWebUrls(payload), 2);
});

test("_isSynthesisFailureReport returns false for real answers", () => {
  assert.equal(
    _isSynthesisFailureReport("Darth Revan was a Sith Lord who fell to the dark side.", emptyPayload),
    false,
  );
});

// ---------------------------------------------------------------------------
// _normalizeReport
// ---------------------------------------------------------------------------

test("_normalizeReport strips a top-level H1 heading", () => {
  const input = "# Research Report\n\nSome content here.";
  const result = _normalizeReport(input);
  assert.ok(!result.startsWith("#"));
  assert.ok(result.includes("Some content here."));
});

test("_normalizeReport collapses 3+ blank lines to 2", () => {
  const input = "Para one.\n\n\n\nPara two.";
  const result = _normalizeReport(input);
  assert.ok(!result.includes("\n\n\n"));
});

test("_normalizeReport trims leading and trailing whitespace", () => {
  const input = "\n\n  Content.  \n\n";
  const result = _normalizeReport(input);
  assert.equal(result, "Content.");
});

test("_normalizeReport strips a Table of Contents section", () => {
  const input = "## Introduction\n\n## Table of Contents\n- Item 1\n- Item 2\n\n## Background\n\nContent.";
  const result = _normalizeReport(input);
  assert.ok(!result.includes("Table of Contents"));
  assert.ok(result.includes("Content."));
});

// ---------------------------------------------------------------------------
// _formatSourcesSection
// ---------------------------------------------------------------------------

const fakeSource = (name: string, url: string): SourceDescriptor => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name,
  kind: "website",
  homeUrl: url,
  description: `Test source: ${name}`,
  freshnessPolicy: "static",
  approvalScope: "full",
  tags: [],
});

test("_formatSourcesSection starts with 'Sources'", () => {
  const result = _formatSourcesSection([fakeSource("KotOR Wiki", "https://kotor.fandom.com")]);
  assert.ok(result.startsWith("Sources\n"));
});

test("_formatSourcesSection numbers entries starting at 1", () => {
  const result = _formatSourcesSection([
    fakeSource("Site A", "https://a.com"),
    fakeSource("Site B", "https://b.com"),
  ]);
  assert.ok(result.includes("1. Site A - https://a.com"));
  assert.ok(result.includes("2. Site B - https://b.com"));
});

test("_formatSourcesSection returns just 'Sources' for empty sources", () => {
  assert.equal(_formatSourcesSection([]), "Sources");
});

// ---------------------------------------------------------------------------
// _normalizePreferredRewriteModel
// ---------------------------------------------------------------------------

test("_normalizePreferredRewriteModel returns undefined for undefined input", () => {
  assert.equal(_normalizePreferredRewriteModel(undefined), undefined);
});

test("_normalizePreferredRewriteModel returns undefined for empty/whitespace string", () => {
  assert.equal(_normalizePreferredRewriteModel(""), undefined);
  assert.equal(_normalizePreferredRewriteModel("   "), undefined);
});

test("_normalizePreferredRewriteModel strips litellm: prefix", () => {
  assert.equal(_normalizePreferredRewriteModel("litellm:gpt-4o"), "gpt-4o");
});

test("_normalizePreferredRewriteModel strips openrouter: prefix", () => {
  assert.equal(_normalizePreferredRewriteModel("openrouter:anthropic/claude-3"), "anthropic/claude-3");
});

test("_normalizePreferredRewriteModel returns the model name when no prefix", () => {
  assert.equal(_normalizePreferredRewriteModel("gpt-4o"), "gpt-4o");
});

test("_normalizePreferredRewriteModel returns undefined for prefix-only string", () => {
  assert.equal(_normalizePreferredRewriteModel("litellm:"), undefined);
  assert.equal(_normalizePreferredRewriteModel("openrouter:"), undefined);
});

// ---------------------------------------------------------------------------
// _matchApprovedSource
// ---------------------------------------------------------------------------

test("_matchApprovedSource returns the source for an exact URL match", () => {
  const sources = [fakeSource("KotOR Wiki", "https://kotor.fandom.com")];
  const match = _matchApprovedSource("https://kotor.fandom.com", sources);
  assert.ok(match);
  assert.equal(match!.name, "KotOR Wiki");
});

test("_matchApprovedSource matches a URL that starts with the source homeUrl", () => {
  const sources = [fakeSource("KotOR Wiki", "https://kotor.fandom.com")];
  const match = _matchApprovedSource("https://kotor.fandom.com/wiki/Darth_Revan", sources);
  assert.ok(match);
  assert.equal(match!.name, "KotOR Wiki");
});

test("_matchApprovedSource returns undefined for a URL not in approved sources", () => {
  const sources = [fakeSource("KotOR Wiki", "https://kotor.fandom.com")];
  const match = _matchApprovedSource("https://evil.com/steal-data", sources);
  assert.equal(match, undefined);
});

test("_matchApprovedSource does not match a sibling domain", () => {
  const sources = [fakeSource("KotOR Wiki", "https://kotor.fandom.com")];
  const match = _matchApprovedSource("https://kotor.fandom.com.evil.com", sources);
  assert.equal(match, undefined);
});

test("_collectVisitedUrlsFromPayload keeps visited URLs separate from citations", () => {
  const sources = [
    fakeSource("MDLOps", "https://github.com/bead-v/mdlops"),
    fakeSource("Wikipedia", "https://en.wikipedia.org/wiki/Star_Wars:_Knights_of_the_Old_Republic"),
  ];
  const payload = {
    report: "Sources\n1. MDLOps - https://github.com/bead-v/mdlops",
    research_information: {
      cited_urls: ["https://github.com/bead-v/mdlops"],
      retrieved_urls: [
        "https://github.com/bead-v/mdlops",
        "https://en.wikipedia.org/wiki/Star_Wars:_Knights_of_the_Old_Republic",
      ],
      visited_urls: ["https://en.wikipedia.org/wiki/Star_Wars:_Knights_of_the_Old_Republic"],
    },
  };

  const cited = _collectCitedSources(payload.report, sources, payload);
  const retrieved = _collectRetrievedSources(payload.report, sources, payload);
  const visited = _collectVisitedUrlsFromPayload(payload, sources);

  assert.deepEqual(cited.map((source) => source.homeUrl), ["https://github.com/bead-v/mdlops"]);
  assert.deepEqual(
    retrieved.map((source) => source.homeUrl),
    [
      "https://github.com/bead-v/mdlops",
      "https://en.wikipedia.org/wiki/Star_Wars:_Knights_of_the_Old_Republic",
    ],
  );
  assert.deepEqual(visited, ["https://en.wikipedia.org/wiki/Star_Wars:_Knights_of_the_Old_Republic"]);
});

test("_collectCitedSourcesFromText only trusts the Sources section", () => {
  const sources = [
    fakeSource("MDLOps", "https://github.com/bead-v/mdlops"),
    fakeSource("StrategyWiki", "https://strategywiki.org/wiki/Star_Wars:_Knights_of_the_Old_Republic"),
  ];
  const answer = [
    "MDLOps converts and re-imports KotOR models [1].",
    "Background: https://strategywiki.org/wiki/Star_Wars:_Knights_of_the_Old_Republic",
    "",
    "Sources",
    "1. MDLOps - https://github.com/bead-v/mdlops",
  ].join("\n");

  const cited = _collectCitedSourcesFromText(answer, sources);
  assert.deepEqual(cited.map((source) => source.homeUrl), ["https://github.com/bead-v/mdlops"]);
});

test("_classifyQueryIntent identifies tooling and lore questions separately", () => {
  assert.equal(_classifyQueryIntent("What is MDLOps used for in the KOTOR toolchain?"), "tooling");
  assert.equal(_classifyQueryIntent("Who is Bastila Shan in KOTOR?"), "lore");
});

test("_routeSourcesForQuery keeps lore sources out of tooling searches", () => {
  const sources = [
    fakeSource("Deadly Stream", "https://deadlystream.com"),
    {
      ...fakeSource("Wikipedia — Star Wars KOTOR", "https://en.wikipedia.org/wiki/Star_Wars:_Knights_of_the_Old_Republic"),
      id: "wikipedia-kotor",
    },
    {
      ...fakeSource("StrategyWiki KOTOR", "https://strategywiki.org/wiki/Star_Wars:_Knights_of_the_Old_Republic"),
      id: "strategywiki-kotor",
    },
  ];

  const routed = _routeSourcesForQuery("What is MDLOps used for in the KOTOR toolchain?", sources);
  assert.deepEqual(routed.map((source) => source.name), ["Deadly Stream"]);
});

test("_alignCitedSourcesToAnswer returns only body-cited sources", () => {
  const sources = [
    fakeSource("Deadly Stream", "https://deadlystream.com/topic/1"),
    fakeSource("Neocities", "https://kotor.neocities.org/modding/tslpatcher/"),
    fakeSource("GitHub", "https://github.com/bead-v/mdlops"),
  ];
  const answer = [
    "TSLPatcher edits 2DA and GFF files [1].",
    "",
    "Sources",
    "1. Deadly Stream - https://deadlystream.com/topic/1",
    "2. Neocities - https://kotor.neocities.org/modding/tslpatcher/",
    "3. GitHub - https://github.com/bead-v/mdlops",
  ].join("\n");

  const aligned = _alignCitedSourcesToAnswer(answer, sources);
  assert.deepEqual(aligned.map((source) => source.homeUrl), ["https://deadlystream.com/topic/1"]);
});

test("_alignCitedSourcesToAnswer returns empty when body has no citations", () => {
  const sources = [fakeSource("Deadly Stream", "https://deadlystream.com/topic/1")];
  const answer = "I found pages but cannot cite them yet.\n\nSources\n1. Deadly Stream - https://deadlystream.com/topic/1";
  assert.deepEqual(_alignCitedSourcesToAnswer(answer, sources), []);
});
