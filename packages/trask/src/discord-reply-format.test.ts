import test from "node:test";
import assert from "node:assert/strict";

import {
  citationIndicesInLines,
  citationIndicesInText,
  clampDiscordBodyLines,
  embedInlineCitationLinks,
  ensureMinimumDistinctCitedLines,
  filterDiscordLinesForQuery,
  formatDiscordAskDisplay,
} from "./discord-reply-format.js";
import { BRIEF_DISCORD_MIN_CITATIONS } from "./grounded-evidence.js";

const expertTslpatcherRaw = `TSLPatcher on GitHub The TSLPatcher project documents how mod authors ship list-driven 2DA, GFF, and TLK changes for KotOR and TSL installs. [1]
TSLPatcher is a mod installation tool for Knights of the Old Republic and The Sith Lords. It applies 2DA, GFF, and TLK patches from list files so players do not copy files by hand. [2]

Sources
1. github.com - https://github.com/th3w1zard1/TSLPatcher
2. Deadly Stream - https://deadlystream.com/files/file/1982-tslpatcher`;

const expertQuery =
  "When a KotOR mod ships 2DA and TLK changes, what does TSLPatcher automate that manual file copying cannot?";

const approvedSources = [
  { name: "github.com", homeUrl: "https://github.com/th3w1zard1/TSLPatcher" },
  { name: "Deadly Stream", homeUrl: "https://deadlystream.com/files/file/1982-tslpatcher" },
];

test("formatDiscordAskDisplay keeps two https links for expert TSLPatcher query", () => {
  const display = formatDiscordAskDisplay(expertTslpatcherRaw, approvedSources, { query: expertQuery });
  const links = [...display.matchAll(/\]\((https:\/\/[^)]+)\)/g)];
  assert.equal(links.length, 2, display);
  assert.doesNotMatch(display, /\nSources\s*\n/i);
});

test("formatDiscordAskDisplay strips Sources block from display", () => {
  const display = formatDiscordAskDisplay(expertTslpatcherRaw, approvedSources, { query: expertQuery });
  assert.doesNotMatch(display, /^\s*Sources\b/im);
});

test("ensureMinimumDistinctCitedLines backfills second distinct citation", () => {
  const line1 =
    "TSLPatcher applies 2DA and TLK patches from list files for KotOR mod installs. [1]";
  const line2 =
    "The TSLPatcher GitHub repo documents list-driven GFF and TLK changes. [2]";
  const pool = [line1, line2];
  const selected = [line1];

  const out = ensureMinimumDistinctCitedLines(
    selected,
    pool,
    expertQuery,
    BRIEF_DISCORD_MIN_CITATIONS,
  );

  assert.equal(out.length, 2);
  const indices = citationIndicesInLines(out);
  assert.equal(indices.size, BRIEF_DISCORD_MIN_CITATIONS);
  assert.ok(indices.has(1));
  assert.ok(indices.has(2));
});

test("ensureMinimumDistinctCitedLines leaves single-cited pool unchanged", () => {
  const line1 = "Only one cited line about TSLPatcher 2DA patches. [1]";
  const out = ensureMinimumDistinctCitedLines(
    [line1],
    [line1],
    expertQuery,
    BRIEF_DISCORD_MIN_CITATIONS,
  );

  assert.equal(out.length, 1);
  assert.match(out[0]!, /\[1\]/);
});

test("filterDiscordLinesForQuery preserves two citations when pool supports it", () => {
  const line1 =
    "TSLPatcher on GitHub documents list-driven 2DA, GFF, and TLK changes for KotOR. [1]";
  const line2 =
    "TSLPatcher automates mod installs so players do not copy 2DA files by hand. [2]";
  const offTopic = "Unrelated widescreen resolution tweak for KOTOR on PC. [3]";

  const filtered = filterDiscordLinesForQuery([line1, line2, offTopic], expertQuery);

  const indices = citationIndicesInLines(filtered);
  assert.ok(indices.size >= BRIEF_DISCORD_MIN_CITATIONS, filtered.join(" | "));
  assert.ok(
    !filtered.some((line) => line.includes("[3]")),
    "off-topic cited line should be dropped",
  );
});

test("clampDiscordBodyLines keeps two distinct citations when line cap truncates pool", () => {
  const line1 =
    "TSLPatcher on GitHub documents list-driven 2DA, GFF, and TLK changes for KotOR mod installs. [1]";
  const line2 =
    "TSLPatcher automates 2DA and TLK list patches so players do not copy files by hand. [2]";
  const line3 = "Extra KotOR modding context about widescreen and resolution tweaks. [3]";
  const body = [line1, line2, line3].join("\n");

  const clamped = clampDiscordBodyLines(body, 2, expertQuery);
  assert.ok(citationIndicesInText(clamped).size >= BRIEF_DISCORD_MIN_CITATIONS, clamped);
});

test("clampDiscordBodyLines backfills missing citation when first capped lines share one index", () => {
  const line1 = "TSLPatcher applies 2DA list patches for KotOR mod installs. [1]";
  const line2 = "TSLPatcher also documents TLK list changes on GitHub for modding. [1]";
  const line3 = "The TSLPatcher GitHub repo covers GFF and TLK install automation. [2]";
  const body = [line1, line2, line3].join("\n");

  const clamped = clampDiscordBodyLines(body, 2, expertQuery);
  assert.equal(citationIndicesInText(clamped).size, BRIEF_DISCORD_MIN_CITATIONS, clamped);
});

test("citationIndicesInText recognizes three-digit citation index [10]", () => {
  const line =
    "Extended KotOR modding docs reference TLK list formats and patch tooling. [10]";
  const indices = citationIndicesInText(line);
  assert.ok(indices.has(10), [...indices].join(","));
});

test("embedInlineCitationLinks links [10] when citation map includes index 10", () => {
  const body = "Tenth source about TLK automation for large mod lists. [10]";
  const map = new Map([[10, "https://example.com/tlk-list"]]);
  const linked = embedInlineCitationLinks(body, map);
  assert.match(linked, /\[10\]\(https:\/\/example\.com\/tlk-list\)/);
});

test("formatDiscordAskDisplay preserves two links when body has low-score second citation", () => {
  const raw = `TSLPatcher applies 2DA and TLK list patches for KotOR modding workflows. [1]
A brief note about unrelated widescreen HUD tweaks on PC without a citation marker.
The TSLPatcher GitHub repository documents GFF and TLK list-driven install changes for mod patches. [2]

Sources
1. Deadly Stream - https://deadlystream.com/files/file/1982-tslpatcher
2. github.com - https://github.com/th3w1zard1/TSLPatcher`;

  const display = formatDiscordAskDisplay(raw, approvedSources, { query: expertQuery });
  const links = [...display.matchAll(/\]\((https:\/\/[^)]+)\)/g)];
  assert.ok(links.length >= BRIEF_DISCORD_MIN_CITATIONS, display);
  assert.doesNotMatch(display, /widescreen/i);
});
