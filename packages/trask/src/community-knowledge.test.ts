import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { SearchHit } from "@openkotor/retrieval";

import {
  buildCommunityKnowledgeDigest,
  filterWebArchiveCitationSources,
  mergeCommunityAndWebSources,
  searchHitsToCommunitySources,
} from "./community-knowledge.js";

const sampleHit = (url: string): SearchHit => ({
  sourceId: "approved-discord-knowledge",
  sourceName: "Approved Discord Knowledge",
  kind: "discord",
  title: "#general",
  snippet: "Revan was a Jedi.",
  url,
  score: 3,
  tags: ["discord"],
});

describe("community knowledge helpers", () => {
  test("searchHitsToCommunitySources maps discord permalinks", () => {
    const sources = searchHitsToCommunitySources([
      sampleHit("https://discord.com/channels/1/2/3"),
    ]);
    assert.equal(sources.length, 1);
    assert.equal(sources[0]!.kind, "discord");
    assert.equal(sources[0]!.homeUrl, "https://discord.com/channels/1/2/3");
  });

  test("buildCommunityKnowledgeDigest includes permalink lines", () => {
    const digest = buildCommunityKnowledgeDigest([
      sampleHit("https://discord.com/channels/1/2/3"),
    ]);
    assert.match(digest, /Permalink: https:\/\/discord\.com\/channels\/1\/2\/3/);
  });

  test("filterWebArchiveCitationSources excludes discord URLs", () => {
    const web = {
      id: "w1",
      name: "Web",
      kind: "website" as const,
      homeUrl: "https://deadlystream.com",
      description: "fixture",
      freshnessPolicy: "live",
      approvalScope: "global",
      tags: ["web"],
    };
    const discord = searchHitsToCommunitySources([sampleHit("https://discord.com/channels/1/2/3")])[0]!;
    const filtered = filterWebArchiveCitationSources([web, discord]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]!.homeUrl, web.homeUrl);
  });

  test("mergeCommunityAndWebSources dedupes by URL", () => {
    const web = {
      id: "w1",
      name: "Web",
      kind: "website" as const,
      homeUrl: "https://example.com/a",
      description: "fixture",
      freshnessPolicy: "live",
      approvalScope: "global",
      tags: ["web"],
    };
    const merged = mergeCommunityAndWebSources([web], [web]);
    assert.equal(merged.length, 1);
  });
});
