import test from "node:test";
import assert from "node:assert/strict";

import {
  buildInfoEmbed,
  buildSuccessEmbed,
  buildWarningEmbed,
  buildErrorEmbed,
  asBulletList,
} from "./index.js";

// ---------------------------------------------------------------------------
// asBulletList — pure string helper
// ---------------------------------------------------------------------------

test("asBulletList prefixes each line with '- '", () => {
  const result = asBulletList(["line one", "line two", "line three"]);
  assert.equal(result, "- line one\n- line two\n- line three");
});

test("asBulletList returns an empty string for an empty array", () => {
  assert.equal(asBulletList([]), "");
});

test("asBulletList handles a single-item array", () => {
  assert.equal(asBulletList(["only"]), "- only");
});

// ---------------------------------------------------------------------------
// Embed builder helpers — output shape via .toJSON()
// ---------------------------------------------------------------------------

test("buildInfoEmbed sets title and description", () => {
  const embed = buildInfoEmbed({ title: "Info Title", description: "Info desc" });
  const data = embed.toJSON();
  assert.equal(data.title, "Info Title");
  assert.equal(data.description, "Info desc");
});

test("buildInfoEmbed uses the expected blue color", () => {
  const embed = buildInfoEmbed({ title: "t", description: "d" });
  assert.equal(embed.toJSON().color, 0x3b82f6);
});

test("buildSuccessEmbed uses the expected green color", () => {
  const embed = buildSuccessEmbed({ title: "t", description: "d" });
  assert.equal(embed.toJSON().color, 0x16a34a);
});

test("buildWarningEmbed uses the expected amber color", () => {
  const embed = buildWarningEmbed({ title: "t", description: "d" });
  assert.equal(embed.toJSON().color, 0xf59e0b);
});

test("buildErrorEmbed uses the expected red color", () => {
  const embed = buildErrorEmbed({ title: "t", description: "d" });
  assert.equal(embed.toJSON().color, 0xdc2626);
});

test("embeds include fields when provided", () => {
  const fields = [{ name: "Field A", value: "Value A", inline: false }];
  const embed = buildInfoEmbed({ title: "t", description: "d", fields });
  const data = embed.toJSON();
  assert.ok(data.fields);
  assert.equal(data.fields![0]!.name, "Field A");
  assert.equal(data.fields![0]!.value, "Value A");
});

test("embeds default to the shared footer when no footer is supplied", () => {
  const embed = buildInfoEmbed({ title: "t", description: "d" });
  assert.ok(embed.toJSON().footer?.text);
  assert.ok(embed.toJSON().footer!.text.length > 0);
});

test("embeds use the supplied footer override", () => {
  const embed = buildInfoEmbed({ title: "t", description: "d", footer: "Custom Footer" });
  assert.equal(embed.toJSON().footer!.text, "Custom Footer");
});

test("embeds include a timestamp", () => {
  const embed = buildInfoEmbed({ title: "t", description: "d" });
  assert.ok(embed.toJSON().timestamp, "Expected a timestamp to be set");
});
