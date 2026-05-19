import type { SearchHit, SourceDescriptor } from "@openkotor/retrieval";
import { isDiscordCitationUrl } from "@openkotor/retrieval";

export const COMMUNITY_SOURCE_ID = "approved-discord-knowledge";

export function searchHitsToCommunitySources(hits: readonly SearchHit[]): SourceDescriptor[] {
  return hits.map((hit, index) => ({
    id: `${COMMUNITY_SOURCE_ID}-hit-${index + 1}`,
    name: hit.title.trim() || "Discord message",
    kind: "discord",
    homeUrl: hit.url,
    description: hit.snippet.slice(0, 280),
    freshnessPolicy: "live-and-imported",
    approvalScope: "approved-channels",
    tags: [...hit.tags, "community"],
  }));
}

export function buildCommunityKnowledgeDigest(hits: readonly SearchHit[]): string {
  if (hits.length === 0) return "";
  const blocks = hits.map((hit, index) => {
    const lines = [
      `[${index + 1}] ${hit.title}`,
      hit.snippet,
      `Permalink: ${hit.url}`,
    ];
    return lines.join("\n");
  });
  return [
    "Community context (lower authority than approved web archives; prefer web sources when they conflict):",
    "",
    ...blocks,
  ].join("\n");
}

export function isCommunityCitationUrl(url: string): boolean {
  return isDiscordCitationUrl(url);
}

export function filterWebArchiveCitationSources(sources: readonly SourceDescriptor[]): SourceDescriptor[] {
  return sources.filter((source) => {
    const url = source.homeUrl.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) return false;
    return !isCommunityCitationUrl(url);
  });
}

export function mergeCommunityAndWebSources(
  webSources: readonly SourceDescriptor[],
  communitySources: readonly SourceDescriptor[],
): SourceDescriptor[] {
  const seen = new Set<string>();
  const merged: SourceDescriptor[] = [];
  for (const source of [...webSources, ...communitySources]) {
    const key = source.homeUrl.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(source);
  }
  return merged;
}
