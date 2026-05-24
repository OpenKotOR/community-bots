import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { splitResearchAnswer, syncSourcesSectionToApproved } from "./research-answer-split.js";

describe("splitResearchAnswer", () => {
  test("returns whole value as body when no Sources heading", () => {
    const { body, sourceLines } = splitResearchAnswer("Line one [1]\nLine two [2]");
    assert.equal(body, "Line one [1]\nLine two [2]");
    assert.deepEqual(sourceLines, []);
  });

  test("splits on plain Sources heading", () => {
    const raw = "Body [1].\n\nSources\n1. A - https://a.example\n2. B - https://b.example";
    const { body, sourceLines } = splitResearchAnswer(raw);
    assert.equal(body, "Body [1].");
    assert.deepEqual(sourceLines, ["1. A - https://a.example", "2. B - https://b.example"]);
  });

  test("splits on markdown Sources heading", () => {
    const raw = "Intro [1].\n\n## Sources\n1. X - https://x.example";
    const { body, sourceLines } = splitResearchAnswer(raw);
    assert.equal(body, "Intro [1].");
    assert.deepEqual(sourceLines, ["1. X - https://x.example"]);
  });

  test("splits on References heading", () => {
    const raw = "Answer.\n\nReferences\n1. Ref - https://ref.example";
    const { body, sourceLines } = splitResearchAnswer(raw);
    assert.equal(body, "Answer.");
    assert.deepEqual(sourceLines, ["1. Ref - https://ref.example"]);
  });

  test("collapses runs of blank lines in body", () => {
    const raw = "Line one\n\n\n\nLine two\n\nSources\n1. S - https://s.example";
    const { body } = splitResearchAnswer(raw);
    assert.equal(body, "Line one\n\nLine two");
  });
});

describe("syncSourcesSectionToApproved", () => {
  test("rewrites Sources block from approved catalog order", () => {
    const raw = "Body [1].\n\nSources\n1. Old - https://old.example";
    const synced = syncSourcesSectionToApproved(raw, [
      { name: "Neo", homeUrl: "https://neo.example" },
      { name: "DS", homeUrl: "https://ds.example" },
    ]);
    assert.match(synced, /^Body \[1\]\./);
    assert.match(synced, /\nSources\n/);
    assert.match(synced, /1\. Neo - https:\/\/neo\.example/);
    assert.match(synced, /2\. DS - https:\/\/ds\.example/);
    assert.doesNotMatch(synced, /old\.example/);
  });

  test("returns body only when approved list is empty", () => {
    const raw = "Only body [1].\n\nSources\n1. X - https://x.example";
    assert.equal(syncSourcesSectionToApproved(raw, []), "Only body [1].");
  });

  test("uses homeUrl as label when name is missing", () => {
    const synced = syncSourcesSectionToApproved("Answer.\n\nSources\n1. x", [
      { homeUrl: "https://catalog.example/page" },
    ]);
    assert.match(synced, /1\. https:\/\/catalog\.example\/page - https:\/\/catalog\.example\/page/);
  });
});
