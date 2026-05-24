import test from "node:test";
import assert from "node:assert/strict";

import { formatDiscordAskDisplay } from "./discord-reply-format.js";

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
