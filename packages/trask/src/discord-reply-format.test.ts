import test from "node:test";
import assert from "node:assert/strict";

import {
  splitResearchAnswer,
  formatProactivePlainReply,
  formatDiscordAskDisplay,
  syncSourcesSectionToApproved,
  embedInlineCitationLinks,
  buildCitationUrlMap,
  clampDiscordBodyLines,
  dedupeLeadingTopicLabel,
  normalizeBodyCitationIndices,
} from "./discord-reply-format.js";

// ---------------------------------------------------------------------------
// splitResearchAnswer
// ---------------------------------------------------------------------------

test("splitResearchAnswer splits on a 'Sources' header", () => {
  const input = "This is the answer.\n\nSources\nhttps://example.com\nhttps://other.com";
  const { body, sourceLines } = splitResearchAnswer(input);
  assert.ok(body.includes("This is the answer."));
  assert.equal(sourceLines.length, 2);
  assert.ok(sourceLines.includes("https://example.com"));
});

test("splitResearchAnswer is case-insensitive on 'Sources' header", () => {
  const input = "Body text.\n\nSOURCES\nhttps://a.com";
  const { body, sourceLines } = splitResearchAnswer(input);
  assert.ok(body.includes("Body text."));
  assert.equal(sourceLines.length, 1);
});

test("splitResearchAnswer returns empty sourceLines when no Sources section exists", () => {
  const input = "Just an answer with no sources.";
  const { body, sourceLines } = splitResearchAnswer(input);
  assert.equal(body, "Just an answer with no sources.");
  assert.deepEqual(sourceLines, []);
});

test("splitResearchAnswer normalizes excessive blank lines in body", () => {
  const input = "Line one.\n\n\n\nLine two.\n\nSources\nhttps://x.com";
  const { body } = splitResearchAnswer(input);
  assert.ok(!body.includes("\n\n\n"), "Three+ consecutive newlines should be collapsed");
});

test("splitResearchAnswer trims leading and trailing whitespace from body", () => {
  const input = "  \n  Answer text.  \n  \n\nSources\nhttps://x.com";
  const { body } = splitResearchAnswer(input);
  assert.equal(body, "Answer text.");
});

test("splitResearchAnswer filters blank source lines", () => {
  const input = "Answer.\n\nSources\nhttps://a.com\n\n\nhttps://b.com\n";
  const { sourceLines } = splitResearchAnswer(input);
  assert.equal(sourceLines.length, 2);
});

test("splitResearchAnswer handles Sources-only input (empty body)", () => {
  const input = "\nSources\nhttps://only-source.com";
  const { body, sourceLines } = splitResearchAnswer(input);
  assert.equal(body, "");
  assert.equal(sourceLines.length, 1);
});

// ---------------------------------------------------------------------------
// formatProactivePlainReply
// ---------------------------------------------------------------------------

const opts = { maxBodyChars: 200, maxSources: 3 };

test("formatProactivePlainReply returns plain text when no sources are present", () => {
  const result = formatProactivePlainReply("Short answer with no sources.", opts);
  assert.equal(result, "Short answer with no sources.");
  assert.ok(!result.includes("Sources:"));
});

test("formatProactivePlainReply appends source URLs after body", () => {
  const raw = "Answer body.\n\nSources\n1. Site — https://example.com";
  const result = formatProactivePlainReply(raw, opts);
  assert.ok(result.includes("Sources: https://example.com"));
});

test("formatProactivePlainReply strips markdown heading prefixes from body", () => {
  const raw = "## Heading Answer\n\nBody text.\n\nSources\nhttps://x.com";
  const result = formatProactivePlainReply(raw, opts);
  assert.ok(!result.includes("##"), "Markdown heading should be stripped");
});

test("formatProactivePlainReply truncates body to maxBodyChars and appends ellipsis", () => {
  const longBody = "A".repeat(300);
  const result = formatProactivePlainReply(longBody, { maxBodyChars: 100, maxSources: 3 });
  assert.ok(result.endsWith("…"));
  assert.ok(result.length <= 101);  // 100 chars + "…"
});

test("formatProactivePlainReply respects maxSources limit", () => {
  const sources = Array.from({ length: 10 }, (_, i) => `https://source${i}.com`).join("\n");
  const raw = `Answer.\n\nSources\n${sources}`;
  const result = formatProactivePlainReply(raw, { maxBodyChars: 500, maxSources: 3 });
  const matches = [...result.matchAll(/https?:\/\//g)];
  assert.equal(matches.length, 3);
});

test("formatProactivePlainReply deduplicates repeated URLs", () => {
  const raw = "Answer.\n\nSources\nhttps://dup.com\nhttps://dup.com\nhttps://unique.com";
  const result = formatProactivePlainReply(raw, { maxBodyChars: 500, maxSources: 10 });
  const matches = [...result.matchAll(/https:\/\/dup\.com/g)];
  assert.equal(matches.length, 1, "Duplicate URL should appear only once");
});

test("formatProactivePlainReply strips trailing punctuation from extracted URLs", () => {
  const raw = "Answer.\n\nSources\n1. See https://example.com.";
  const result = formatProactivePlainReply(raw, opts);
  assert.ok(result.includes("https://example.com"));
  assert.ok(!result.includes("https://example.com."), "Trailing period should be stripped");
});

test("formatProactivePlainReply uses ' · ' as URL separator", () => {
  const raw = "Answer.\n\nSources\nhttps://a.com\nhttps://b.com";
  const result = formatProactivePlainReply(raw, { maxBodyChars: 500, maxSources: 5 });
  assert.ok(result.includes("https://a.com · https://b.com"));
});

// ---------------------------------------------------------------------------
// formatDiscordAskDisplay
// ---------------------------------------------------------------------------

test("formatDiscordAskDisplay clamps to five lines and hides Sources block", () => {
  const raw = [
    "Line one [1].",
    "Line two [2].",
    "Line three.",
    "Line four.",
    "Line five.",
    "Line six should drop.",
    "",
    "Sources",
    "1. Neocities - https://kotor.neocities.org/modding/tslpatcher/",
    "2. Deadly Stream - https://deadlystream.com/topic/1",
  ].join("\n");
  const result = formatDiscordAskDisplay(raw);
  assert.equal(result.split("\n").length, 5);
  assert.ok(!/^\s*Sources\b/im.test(result));
  assert.ok(!result.includes("Neocities -"));
});

test("syncSourcesSectionToApproved rewrites Sources lines from approvedSources", () => {
  const raw =
    "Fact [1].\n\nSources\n1. Old - https://deadlystream.com/";
  const synced = syncSourcesSectionToApproved(raw, [
    { name: "Neocities", homeUrl: "https://kotor.neocities.org/modding/tslpatcher/" },
  ]);
  assert.match(synced, /kotor\.neocities\.org\/modding\/tslpatcher/);
});

test("formatDiscordAskDisplay embeds citations as linked numbers", () => {
  const raw =
    "TSLPatcher edits 2DA and GFF [1].\n\nSources\n1. Neocities - https://kotor.neocities.org/modding/tslpatcher/";
  const result = formatDiscordAskDisplay(raw);
  assert.match(result, /\[1\]\(https:\/\/kotor\.neocities\.org\/modding\/tslpatcher\/\)/);
});

test("embedInlineCitationLinks leaves unknown indices unchanged", () => {
  const map = buildCitationUrlMap(["1. A - https://example.com/a"], []);
  const out = embedInlineCitationLinks("Fact [1] and [9].", map);
  assert.match(out, /\[1\]\(https:\/\/example\.com\/a\)/);
  assert.ok(out.includes("[9]"));
});

test("clampDiscordBodyLines splits an overlong single paragraph", () => {
  const blob = `${"Word. ".repeat(80)}Done.`;
  const lines = clampDiscordBodyLines(blob, 3).split("\n");
  assert.ok(lines.length <= 3);
});

test("normalizeBodyCitationIndices remaps sparse markers to 1..N", () => {
  assert.equal(
    normalizeBodyCitationIndices("Fact [4] and more [9] then [4] again."),
    "Fact [1] and more [2] then [1] again.",
  );
});

test("formatDiscordAskDisplay unwraps brief bullet-hash lines and links citations", () => {
  const raw = [
    "Answer for: What is TSLPatcher?",
    "",
    "- # TSLPatcher TSLPatcher applies 2DA, GFF, and TLK patches for KotOR mods. [1]",
    "- # reone Odyssey engine Open-source engine reimplementation. [2]",
    "",
    "Sources",
    "1. Neocities - https://kotor.neocities.org/modding/tslpatcher/",
    "2. reone - https://github.com/reone/reone",
  ].join("\n");
  const result = formatDiscordAskDisplay(
    raw,
    [
      { name: "Neocities", homeUrl: "https://kotor.neocities.org/modding/tslpatcher/" },
      { name: "reone", homeUrl: "https://github.com/reone/reone" },
    ],
    { query: "What is TSLPatcher used for in KOTOR modding?" },
  );
  assert.match(result, /2DA, GFF, and TLK/);
  assert.match(result, /\[1\]\(https:\/\/kotor\.neocities\.org\/modding\/tslpatcher\/\)/);
  assert.ok(!/reone/i.test(result), "off-topic reone line should be filtered");
  assert.ok(result.split("\n").length <= 5);
  assert.ok(!/^\s*Sources\b/im.test(result));
});

test("dedupeLeadingTopicLabel removes repeated topic token", () => {
  assert.equal(
    dedupeLeadingTopicLabel("TSLPatcher TSLPatcher is a mod installation tool."),
    "TSLPatcher is a mod installation tool.",
  );
});
