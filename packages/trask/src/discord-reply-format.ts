import { loadTraskPolicy } from "@openkotor/trask-config";

import {
  BARE_CITATION_INDEX_CAPTURE_RE,
  CITATION_INDEX_CAPTURE_RE,
  CITATION_MARKER_RE,
  parseCitationIndex,
} from "./citation-markers.js";
import {
  BRIEF_DISCORD_MIN_CITATIONS,
  claimMatchesQueryAnchor,
  distinctiveAnchorTokens,
} from "./query-anchor.js";
import {
  splitResearchAnswer,
  syncSourcesSectionToApproved,
  type ResearchAnswerSource,
} from "./research-answer-split.js";

const discordPolicy = loadTraskPolicy().discord;

const lineHasCitationMarker = (line: string): boolean => CITATION_MARKER_RE.test(line);

export const DISCORD_ASK_MAX_BODY_LINES = discordPolicy.maxBodyLines;
export const DISCORD_ASK_MAX_LINE_CHARS = discordPolicy.maxLineChars;
export const DISCORD_ASK_DESCRIPTION_MAX_LENGTH = discordPolicy.descriptionMaxLength;

export type DiscordCitationSource = ResearchAnswerSource;

export { splitResearchAnswer, syncSourcesSectionToApproved };

const stripTrailingUrlPunctuation = (url: string): string => {
  let end = url.length;
  while (end > 0 && ",.;:!?)".includes(url[end - 1]!)) {
    end -= 1;
  }
  return url.slice(0, end);
};

/** Linear scan for first http(s) URL (CodeQL-safe; no backtracking regex on user text). */
const findHttpUrlInText = (text: string, fromIndex = 0): string | null => {
  const httpAt = text.indexOf("http://", fromIndex);
  const httpsAt = text.indexOf("https://", fromIndex);
  const start =
    httpAt < 0 ? httpsAt : httpsAt < 0 ? httpAt : Math.min(httpAt, httpsAt);
  if (start < 0) return null;
  let end = start;
  while (end < text.length) {
    const ch = text[end]!;
    if (ch <= " " || ch === ")" || ch === "]") break;
    end += 1;
  }
  const raw = text.slice(start, end);
  return raw ? stripTrailingUrlPunctuation(raw) : null;
};

const parseNumberedSourceLine = (line: string): { index: number; url: string } | null => {
  let i = 0;
  while (i < line.length && line[i] === " ") i += 1;
  let digits = "";
  while (i < line.length) {
    const ch = line[i]!;
    if (ch < "0" || ch > "9") break;
    digits += ch;
    i += 1;
  }
  if (!digits || line[i] !== ".") return null;
  i += 1;
  const url = findHttpUrlInText(line, i);
  if (!url) return null;
  return { index: Number(digits), url };
};

const extractUrlFromSourceLine = (line: string): string | null => {
  const numbered = parseNumberedSourceLine(line);
  if (numbered) return numbered.url;
  return findHttpUrlInText(line);
};

/** Map citation index [1] → URL from the Sources block or approved catalog order. */
export const buildCitationUrlMap = (
  sourceLines: readonly string[],
  approvedSources: readonly DiscordCitationSource[],
): Map<number, string> => {
  const map = new Map<number, string>();

  for (const line of sourceLines) {
    const numbered = parseNumberedSourceLine(line);
    if (numbered) {
      map.set(numbered.index, numbered.url);
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
  return body.replace(CITATION_INDEX_CAPTURE_RE, (_match, rawIndex: string) => {
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
  body.replace(BARE_CITATION_INDEX_CAPTURE_RE, (_match, rawIndex: string) => {
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
  claimMatchesQueryAnchor({ claim: line, quote: line }, query);

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

export const citationIndicesInLines = (lines: readonly string[]): Set<number> => {
  const indices = new Set<number>();
  for (const line of lines) {
    const captureRe = new RegExp(CITATION_INDEX_CAPTURE_RE.source, "g");
    for (const match of line.matchAll(captureRe)) {
      const index = parseCitationIndex(match[1]!);
      if (index !== null) {
        indices.add(index);
      }
    }
  }
  return indices;
};

/** Distinct `[n]` indices in a multi-line body (splits on `\n` for line-scoped matching). */
export const citationIndicesInText = (text: string): Set<number> =>
  citationIndicesInLines(text.split("\n"));

const swapWeakOffTopicCitedLines = (
  selected: readonly string[],
  pool: readonly string[],
  query: string,
  minDistinct: number,
): string[] => {
  let out = [...selected];
  for (let i = 0; i < out.length; i += 1) {
    const line = out[i]!;
    const lineScore = scoreLineForQuery(line, query);
    if (lineMatchesQueryAnchor(line, query)) {
      continue;
    }
    const replacement = pool
      .filter((candidate) => candidate !== line && !out.includes(candidate))
      .map((candidate) => ({ candidate, score: scoreLineForQuery(candidate, query) }))
      .filter(({ candidate, score }) => score > lineScore && (score > 0 || lineMatchesQueryAnchor(candidate, query)))
      .sort((left, right) => right.score - left.score)[0]?.candidate;
    if (!replacement) {
      continue;
    }
    const trial = [...out];
    trial[i] = replacement;
    if (citationIndicesInLines(trial).size >= minDistinct) {
      out = trial;
    }
  }
  return out;
};

const sliceLinesPreservingDistinctCitations = (
  lines: readonly string[],
  maxLines: number,
  minDistinct: number,
): string[] => {
  if (lines.length <= maxLines) {
    return [...lines];
  }
  const out: string[] = [];
  for (const line of lines) {
    if (!lineHasCitationMarker(line)) {
      continue;
    }
    const beforeSize = citationIndicesInLines(out).size;
    const afterSize = citationIndicesInLines([...out, line]).size;
    if (afterSize <= beforeSize) {
      continue;
    }
    out.push(line);
    if (afterSize >= minDistinct && out.length >= maxLines) {
      return out.slice(0, maxLines);
    }
  }
  for (const line of lines) {
    if (out.includes(line) || out.length >= maxLines) {
      continue;
    }
    out.push(line);
  }
  return out.slice(0, maxLines);
};

/** After query scoring, keep ≥minDistinct citation markers when the pool supports it. */
export const ensureMinimumDistinctCitedLines = (
  selected: readonly string[],
  pool: readonly string[],
  query: string,
  minDistinct: number,
): string[] => {
  const out: string[] = [...selected];
  let indices = citationIndicesInLines(out);

  if (indices.size >= minDistinct) {
    return swapWeakOffTopicCitedLines(out, pool, query, minDistinct).slice(0, DISCORD_ASK_MAX_BODY_LINES);
  }

  const scored = pool
    .filter((line) => !out.includes(line))
    .map((line) => ({ line, score: scoreLineForQuery(line, query) }))
    .filter(({ line, score }) => score > 0 || lineMatchesQueryAnchor(line, query))
    .sort((left, right) => right.score - left.score);

  for (const { line } of scored) {
    const lineIndices = citationIndicesInLines([line]);
    const addsDistinct = [...lineIndices].some((index) => !indices.has(index));
    if (!addsDistinct && indices.size >= minDistinct) {
      continue;
    }
    out.push(line);
    indices = citationIndicesInLines(out);
    if (indices.size >= minDistinct) {
      break;
    }
  }

  return swapWeakOffTopicCitedLines(out, pool, query, minDistinct).slice(0, DISCORD_ASK_MAX_BODY_LINES);
};

/** Keep only lines that match the user question; avoids catalog dumps in Discord embeds. */
export const filterDiscordLinesForQuery = (lines: readonly string[], query: string): string[] => {
  if (lines.length <= 1 || !query.trim()) {
    return [...lines];
  }
  const cited = lines.filter((line) => lineHasCitationMarker(line));
  if (cited.length >= BRIEF_DISCORD_MIN_CITATIONS) {
    const onTopic = scoreAndFilterLines(cited, query);
    if (onTopic.length > 0) {
      return ensureMinimumDistinctCitedLines(onTopic, cited, query, BRIEF_DISCORD_MIN_CITATIONS);
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
    const cited = lines.filter((line) => lineHasCitationMarker(line));
    const uncited = lines.filter((line) => !lineHasCitationMarker(line));
    if (query?.trim() && cited.length >= BRIEF_DISCORD_MIN_CITATIONS) {
      lines = ensureMinimumDistinctCitedLines([], cited, query, BRIEF_DISCORD_MIN_CITATIONS);
    } else if (cited.length > 0) {
      lines = [...cited, ...uncited];
    }
    lines = sliceLinesPreservingDistinctCitations(
      lines,
      maxLines,
      query?.trim() ? BRIEF_DISCORD_MIN_CITATIONS : 1,
    );
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

export type DiscordProvenanceFooterInput = {
  passagesCount: number;
  indexerUrl: string;
};

const indexerFooterLabel = (indexerUrl: string): string => {
  const trimmed = indexerUrl.trim();
  if (!trimmed) return "unknown";
  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      return parsed.port || parsed.hostname;
    }
    return parsed.host;
  } catch {
    return trimmed.replace(/^https?:\/\//iu, "").replace(/\/$/u, "").slice(0, 48);
  }
};

/** One-line embed footer for Discord /ask (passage count + indexer host; not part of the 5-line body). */
export const formatDiscordProvenanceFooter = (input: DiscordProvenanceFooterInput): string => {
  const count = Math.max(0, Math.floor(input.passagesCount));
  const passageLabel = `${count} passage${count === 1 ? "" : "s"}`;
  return `${passageLabel} · indexer ${indexerFooterLabel(input.indexerUrl)}`;
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
