import { loadTraskPolicy } from "@openkotor/trask-config";

import {
  BRIEF_DISCORD_MIN_CITATIONS,
  claimMatchesQueryAnchor,
  distinctiveAnchorTokens,
} from "./grounded-evidence.js";

const normalizeWhitespace = (value: string): string => value.replace(/\n{3,}/g, "\n\n").trim();

const discordPolicy = loadTraskPolicy().discord;

export const DISCORD_ASK_MAX_BODY_LINES = discordPolicy.maxBodyLines;
export const DISCORD_ASK_MAX_LINE_CHARS = discordPolicy.maxLineChars;
export const DISCORD_ASK_DESCRIPTION_MAX_LENGTH = discordPolicy.descriptionMaxLength;

export type DiscordCitationSource = {
  name?: string;
  homeUrl: string;
};

export const splitResearchAnswer = (value: string): { body: string; sourceLines: string[] } => {
  const match = /\nSources\s*\n/i.exec(value);

  if (!match) {
    return {
      body: normalizeWhitespace(value),
      sourceLines: [],
    };
  }

  const body = normalizeWhitespace(value.slice(0, match.index));
  const sourceLines = value
    .slice(match.index + match[0].length)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return { body, sourceLines };
};

const stripTrailingUrlPunctuation = (url: string): string => url.replace(/[.,;:!?)]+$/, "");

const extractUrlFromSourceLine = (line: string): string | null => {
  const numbered = line.match(/^\s*\d+\.\s*.+?\s-\s*(https?:\/\/\S+)/i);
  if (numbered?.[1]) {
    return stripTrailingUrlPunctuation(numbered[1]);
  }
  const bare = line.match(/https?:\/\/[^\s)]+/);
  return bare ? stripTrailingUrlPunctuation(bare[0]) : null;
};

/** Map citation index [1] → URL from the Sources block or approved catalog order. */
export const buildCitationUrlMap = (
  sourceLines: readonly string[],
  approvedSources: readonly DiscordCitationSource[],
): Map<number, string> => {
  const map = new Map<number, string>();

  for (const line of sourceLines) {
    const numbered = line.match(/^\s*(\d+)\.\s*.+?\s-\s*(https?:\/\/\S+)/i);
    if (numbered) {
      map.set(Number(numbered[1]), stripTrailingUrlPunctuation(numbered[2]!));
      continue;
    }
    const url = extractUrlFromSourceLine(line);
    if (url && ![...map.values()].includes(url)) {
      map.set(map.size + 1, url);
    }
  }

  if (map.size === 0) {
    approvedSources.forEach((source, index) => {
      map.set(index + 1, source.homeUrl);
    });
  }

  return map;
};

/** Map citation markers to 1..N in first-seen order so they align with a shortened Sources list. */
export const normalizeBodyCitationIndices = (body: string): string => {
  const seen = new Map<number, number>();
  let next = 1;
  return body.replace(/\[(\d{1,2})\]/g, (_match, rawIndex: string) => {
    const oldIndex = Number(rawIndex);
    let mapped = seen.get(oldIndex);
    if (!mapped) {
      mapped = next;
      next += 1;
      seen.set(oldIndex, mapped);
    }
    return `[${mapped}]`;
  });
};

/** Turn bare [n] markers into Discord markdown links on the number only. */
export const embedInlineCitationLinks = (body: string, citationUrls: ReadonlyMap<number, string>): string =>
  body.replace(/\[(\d{1,2})\]/g, (_match, rawIndex: string) => {
    const index = Number(rawIndex);
    const url = citationUrls.get(index);
    return url ? `[${index}](${url})` : `[${index}]`;
  });

/** Brief compose often emits `- # Title sentence… [n]` bullets — unwrap before line clamping. */
export const unwrapBriefBulletHashLines = (body: string): string =>
  body.replace(/^\s*-\s*#\s+/gm, "").trim();

/** Remove duplicated topic label at line start (e.g. "TSLPatcher TSLPatcher is…"). */
export const dedupeLeadingTopicLabel = (line: string): string => {
  const flattened = line.replace(/\s+/g, " ").trim();
  const duplicateLead = flattened.match(/^(\S+)\s+\1\b/iu);
  return duplicateLead ? flattened.slice(duplicateLead[1]!.length).trimStart() : flattened;
};

const lineMatchesQueryAnchor = (line: string, query: string): boolean =>
  claimMatchesQueryAnchor(
    {
      claim: line,
      quote: line,
      url: "https://example.invalid",
      citationUrl: "https://example.invalid",
      sourceIndex: 1,
      authority: "web",
    },
    query,
  );

const tokenBoundaryRe = (token: string): RegExp => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "iu");
};

const scoreLineForQuery = (line: string, query: string): number => {
  const haystack = line.toLowerCase();
  return distinctiveAnchorTokens(query).reduce(
    (score, token) => (tokenBoundaryRe(token).test(haystack) ? score + token.length : score),
    0,
  );
};

const scoreAndFilterLines = (pool: readonly string[], query: string): string[] => {
  const scored = pool.map((line) => ({ line, score: scoreLineForQuery(line, query) }));
  scored.sort((left, right) => right.score - left.score);
  const best = scored[0]?.score ?? 0;
  if (best <= 0) {
    const anchored = pool.filter((line) => lineMatchesQueryAnchor(line, query));
    return (anchored.length > 0 ? anchored : pool).slice(0, DISCORD_ASK_MAX_BODY_LINES);
  }
  return scored
    .filter((entry) => entry.score >= best * 0.85)
    .slice(0, DISCORD_ASK_MAX_BODY_LINES)
    .map((entry) => entry.line);
};

/** Keep only lines that match the user question; avoids catalog dumps in Discord embeds. */
export const filterDiscordLinesForQuery = (lines: readonly string[], query: string): string[] => {
  if (lines.length <= 1 || !query.trim()) {
    return [...lines];
  }
  const cited = lines.filter((line) => /\[\d{1,2}\]/.test(line));
  if (cited.length >= BRIEF_DISCORD_MIN_CITATIONS) {
    const onTopic = scoreAndFilterLines(cited, query);
    if (onTopic.length > 0) {
      return onTopic;
    }
  }
  return scoreAndFilterLines(lines, query);
};

export const clampDiscordBodyLines = (body: string, maxLines: number, query?: string): string => {
  const cleaned = unwrapBriefBulletHashLines(body)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^Answer for:\s*.+$/im, "")
    .replace(/\bAnswer for:\s*[^\n]+/gi, "")
    .replace(/^\s*Caveats:\s*.+$/im, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*+/g, "")
    .trim();

  let lines = cleaned
    .split(/\r?\n/)
    .map((line) => dedupeLeadingTopicLabel(line.trim()))
    .filter(Boolean);

  if (query?.trim()) {
    lines = filterDiscordLinesForQuery(lines, query);
  }

  if (lines.length > maxLines) {
    const cited = lines.filter((line) => /\[\d{1,2}\]/.test(line));
    const uncited = lines.filter((line) => !/\[\d{1,2}\]/.test(line));
    if (cited.length >= maxLines) {
      lines = cited.slice(0, maxLines);
    } else if (cited.length > 0) {
      lines = [...cited, ...uncited].slice(0, maxLines);
    } else {
      lines = lines.slice(0, maxLines);
    }
  }

  if (lines.length === 1 && lines[0]!.length > DISCORD_ASK_MAX_LINE_CHARS * 2) {
    const sentences = lines[0]!.match(/[^.!?]+[.!?]+/g) ?? [lines[0]!];
    lines = sentences.map((sentence) => sentence.trim()).filter(Boolean);
  }

  return lines
    .slice(0, maxLines)
    .map((line) =>
      line.length > DISCORD_ASK_MAX_LINE_CHARS
        ? `${line.slice(0, Math.max(0, DISCORD_ASK_MAX_LINE_CHARS - 1)).trimEnd()}…`
        : line,
    )
    .join("\n");
};

/** Rewrite the Sources block so numbered lines match `approvedSources` order (deep URLs). */
export const syncSourcesSectionToApproved = (
  rawAnswer: string,
  approvedSources: readonly DiscordCitationSource[],
): string => {
  const { body } = splitResearchAnswer(rawAnswer);
  if (approvedSources.length === 0) {
    return body;
  }

  const lines = approvedSources.map((source, index) => {
    const label = source.name?.trim() || source.homeUrl;
    return `${index + 1}. ${label} - ${source.homeUrl}`;
  });

  return `${body}\n\nSources\n${lines.join("\n")}`;
};

/** Discord /ask display: short body, inline linked [n] citations, no visible Sources block. */
export const formatDiscordAskDisplay = (
  rawAnswer: string,
  approvedSources: readonly DiscordCitationSource[] = [],
  options?: { maxLines?: number; query?: string },
): string => {
  const maxLines = options?.maxLines ?? DISCORD_ASK_MAX_BODY_LINES;
  const alignedAnswer =
    approvedSources.length > 0 ? syncSourcesSectionToApproved(rawAnswer, approvedSources) : rawAnswer;
  const { body, sourceLines } = splitResearchAnswer(alignedAnswer);
  const normalizedBody = normalizeBodyCitationIndices(body);
  const citationUrls = buildCitationUrlMap(sourceLines, approvedSources);
  const clamped = clampDiscordBodyLines(normalizedBody, maxLines, options?.query);
  return embedInlineCitationLinks(clamped, citationUrls).trim();
};

/** Plain, chat-style reply (no embed): short body plus compact source URLs. */
export const formatProactivePlainReply = (
  rawAnswer: string,
  options: { maxBodyChars: number; maxSources: number },
): string => {
  const { body, sourceLines } = splitResearchAnswer(rawAnswer);
  let text = body.replace(/^#{1,6}\s+/gm, "").trim();

  if (text.length > options.maxBodyChars) {
    text = `${text.slice(0, Math.max(0, options.maxBodyChars - 1)).trimEnd()}…`;
  }

  const urls = sourceLines
    .map((line) => extractUrlFromSourceLine(line))
    .filter((url): url is string => Boolean(url));

  const unique = [...new Set(urls)].slice(0, options.maxSources);

  if (unique.length === 0) {
    return text;
  }

  return `${text}\n\nSources: ${unique.join(" · ")}`;
};
