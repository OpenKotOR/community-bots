import OpenAI from "openai";

import { loadSharedAiConfig, type WebResearchRuntimeConfig, type SharedAiConfig } from "@openkotor/config";
import {
  isDiscordCitationUrl,
  isTraskApprovedBaseUrl,
  isTraskApprovedResearchUrl,
  sourceUrlMatchesDescriptor,
  traskApprovedResearchBaseHosts,
  traskApprovedResearchSources,
  type SearchHit,
  type SearchProvider,
  type SourceDescriptor,
} from "@openkotor/retrieval";

import {
  buildCommunityKnowledgeDigest,
  filterWebArchiveCitationSources,
  mergeCommunityAndWebSources,
  searchHitsToCommunitySources,
} from "./community-knowledge.js";

import {
  listHeadlessWebResearchModels,
  runHeadlessWebResearch,
  type HeadlessWebResearchModelOption,
} from "./web-research-subprocess.js";

export interface WebResearchAnswer {
  answer: string;
  /** Sources explicitly cited in the final answer shown to users. */
  approvedSources: readonly SourceDescriptor[];
  /** Sources retrieved as candidate evidence for the answer/rewrite stage. */
  retrievedSources: readonly SourceDescriptor[];
  /** Allowlisted URLs the headless researcher touched while gathering evidence. */
  visitedUrls: readonly string[];
}

export interface WebResearchBriefAnswer extends WebResearchAnswer {
  /** Normalized research report text used for proactive semantic gating. */
  researchReport: string;
}

/** Fine-grained phases for Holocron clients polling thread history. */
export interface WebResearchProgressEvent {
  phase: "gather" | "report" | "sources" | "compose";
  detail?: string;
  sources?: readonly SourceDescriptor[];
}

export interface WebResearchQueryOptions {
  /** Preferred rewrite model id, e.g. `openrouter:openrouter/auto` or `litellm:moonshotai/kimi-k2`. */
  model?: string;
  /** Optional per-request source enablement and weight hints from Holocron's Source Prioritization dialog. */
  sourcePreferences?: readonly WebResearchSourcePreference[];
  /** Imported Discord chunks and/or live channel hits merged before web research. */
  localHits?: readonly SearchHit[];
}

export interface WebResearchClientFactoryOptions {
  /** When set, searches imported chunks when `localHits` are not passed per request. */
  localSearchProvider?: SearchProvider;
  /** Resolves discord:// chunk URLs when searching imported history. */
  discordGuildId?: string;
}

export interface WebResearchSourcePreference {
  name?: string;
  url: string;
  weight: number;
  enabled: boolean;
}

export interface WebResearchModelOption extends HeadlessWebResearchModelOption {}

/** Structural type for adapters that only need full Q&A (e.g. Trask HTTP `/ask`). */
export interface WebResearchQueryHandler {
  answerQuestion(
    query: string,
    onProgress?: (event: WebResearchProgressEvent) => void,
    options?: WebResearchQueryOptions,
  ): Promise<WebResearchAnswer>;
  listModels?(): Promise<readonly WebResearchModelOption[]>;
}

const DEFAULT_WEB_RESEARCH_MODELS: readonly WebResearchModelOption[] = [
  { id: "auto", label: "Auto", provider: "Trask web research", recommended: true },
];

interface WebResearchResponsePayload {
  report?: string | null;
  research_information?: {
    source_urls?: readonly string[] | null;
    cited_urls?: readonly string[] | null;
    retrieved_urls?: readonly string[] | null;
    visited_urls?: readonly string[] | null;
    query_domains?: readonly string[] | null;
    allowed_url_prefixes?: readonly string[] | null;
    rejected_source_urls?: readonly string[] | null;
  };
}

const buildResearchTask = (query: string): string => {
  return query.trim();
};

const buildCustomPrompt = (): string => {
  return [
    "Answer the user's question as a Discord-native KOTOR assistant reply using only the provided research context.",
    "Requirements:",
    "- Lead with the answer, not an introduction.",
    "- Sound direct, practical, and helpful.",
    "- Keep the answer concise: at most 3 short paragraphs or 5 compact bullets total before sources.",
    "- Do not describe your research process, retrieval steps, indexing, backend systems, or source policy unless the user explicitly asks.",
    "- Include inline numeric citations like [1] tied to concrete claims.",
    ' - End with the exact heading "Sources" on its own line.',
    "- Under Sources, list only the sources you cited, each on its own numbered line in the format: 1. Source Name - URL",
    "- Do not add markdown headings other than the final Sources heading.",
  ].join("\n");
};

const buildCustomPromptBrief = (): string => {
  return [
    "Produce a compact research digest for Star Wars: Knights of the Old Republic (KOTOR 1/2) modding questions.",
    "Constraints:",
    "- Stay under ~900 words; bullet key facts when possible.",
    "- Do not narrate tooling, retrieval steps, or how you searched.",
    "- Prefer actionable answers over background essays.",
    "- Include inline numeric citations like [1] tied to concrete claims.",
    ' - End with the exact heading "Sources" on its own line.',
    "- Under Sources, list only cited sources as numbered lines: 1. Source Name - URL",
  ].join("\n");
};

const stripTrailingChars = (value: string, chars: string): string => {
  let end = value.length;
  while (end > 0 && chars.includes(value[end - 1]!)) end -= 1;
  return value.slice(0, end);
};

const stripTrailingSlashes = (value: string): string => stripTrailingChars(value, "/");

const stripTrailingQuestionMarks = (value: string): string => stripTrailingChars(value.trim(), "?");

const collapseExcessiveNewlines = (value: string): string => {
  const lines = value.split("\n");
  const out: string[] = [];
  let blankRun = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blankRun += 1;
      if (blankRun <= 1) out.push("");
    } else {
      blankRun = 0;
      out.push(line);
    }
  }
  return out.join("\n").trim();
};

const isSourcesHeadingLine = (line: string): boolean => {
  let trimmed = line.trim();
  if (trimmed.startsWith("#")) {
    while (trimmed.startsWith("#")) trimmed = trimmed.slice(1);
    trimmed = trimmed.trimStart();
  }
  return /^sources$/iu.test(trimmed) || /^references$/iu.test(trimmed);
};

const splitAtSourcesHeading = (value: string): string => {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (isSourcesHeadingLine(lines[i] ?? "")) {
      return lines.slice(0, i).join("\n");
    }
  }
  return normalized;
};

const extractSourceSectionUrls = (value: string): string[] => {
  const normalized = value.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (isSourcesHeadingLine(lines[i] ?? "")) {
      return extractUrls(lines.slice(i + 1).join("\n"));
    }
  }
  return extractUrls(normalized);
};

const isUrlTerminator = (ch: string): boolean => /\s/u.test(ch) || ch === ")" || ch === ">" || ch === "]";

const extractUrls = (value: string): string[] => {
  const urls: string[] = [];
  const lower = value.toLowerCase();
  let i = 0;
  while (i < value.length) {
    const httpsIdx = lower.indexOf("https://", i);
    const httpIdx = lower.indexOf("http://", i);
    if (httpsIdx === -1 && httpIdx === -1) break;
    const start = httpsIdx === -1
      ? httpIdx
      : httpIdx === -1
        ? httpsIdx
        : Math.min(httpsIdx, httpIdx);
    let end = start;
    while (end < value.length && !isUrlTerminator(value[end]!)) end += 1;
    urls.push(stripTrailingChars(value.slice(start, end), ".,;:!?"));
    i = end;
  }
  return [...new Set(urls)];
};

const rewriteMarkdownLinks = (
  text: string,
  onLink: (label: string, url: string) => string,
): string => {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "[") {
      result += text[i];
      i += 1;
      continue;
    }
    const closeBracket = text.indexOf("]", i + 1);
    if (closeBracket === -1 || text[closeBracket + 1] !== "(") {
      result += text[i];
      i += 1;
      continue;
    }
    const closeParen = text.indexOf(")", closeBracket + 2);
    if (closeParen === -1) {
      result += text[i];
      i += 1;
      continue;
    }
    const label = text.slice(i + 1, closeBracket);
    const url = text.slice(closeBracket + 2, closeParen);
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      result += text.slice(i, closeParen + 1);
      i = closeParen + 1;
      continue;
    }
    result += onLink(label, url);
    i = closeParen + 1;
  }
  return result;
};

/** True when the line opens with 1–6 `#` characters followed by Unicode whitespace (ATX heading). */
const isAtxMarkdownHeadingLine = (line: string): boolean => {
  let i = 0;
  let hashes = 0;
  while (i < line.length && line[i] === "#" && hashes < 6) {
    hashes += 1;
    i += 1;
  }
  if (hashes === 0 || hashes > 6) return false;
  if (i >= line.length) return false;
  return /\s/u.test(line[i]!);
};

const stripMarkdownHeaders = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !isAtxMarkdownHeadingLine(line))
    .join("\n");

/** Pipe-delimited markdown table row heuristic: trimmed line starts and ends with `|`. */
const looksLikeMarkdownTableRow = (line: string): boolean => {
  const trimmed = line.trim();
  return trimmed.length >= 2 && trimmed[0] === "|" && trimmed[trimmed.length - 1] === "|";
};

const stripMarkdownTableRows = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !looksLikeMarkdownTableRow(line))
    .join("\n");

const stripAsteriskRuns = (text: string): string => {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text[i] === "*") {
      while (i < text.length && text[i] === "*") i += 1;
      continue;
    }
    out += text[i];
    i += 1;
  }
  return out;
};

const splitParagraphs = (text: string): string[] => {
  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      if (current.length > 0) {
        paragraphs.push(current.join("\n").trim());
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) paragraphs.push(current.join("\n").trim());
  return paragraphs.filter((paragraph) => paragraph.length > 0);
};

const normalizeUrl = (value: string): string => stripTrailingSlashes(value).trim();

const hostnameHint = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return url.slice(0, 48);
  }
};

/** Dedupe by normalized URL; preserves first-seen order for stable Holocron pulses. */
const uniqueUrlsPreserveOrder = (urls: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const u = normalizeUrl(raw);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
};

const payloadUrls = (values: readonly string[] | null | undefined): string[] =>
  Array.isArray(values) ? values.filter((value): value is string => typeof value === "string") : [];

const isAllowedSourceUrl = (url: string, sourcePool: readonly SourceDescriptor[]): boolean => {
  if (!isPublicWebCitationUrl(url)) return false;
  if (sourcePool.some((source) => sourceUrlMatchesDescriptor(url, source))) return true;
  if (isTraskApprovedResearchUrl(url, sourcePool)) return true;
  return isTraskApprovedBaseUrl(url);
};

/** Visited URLs from web research payload (Holocron live facet pings). */
const collectVisitedUrlsFromPayload = (
  payload: WebResearchResponsePayload,
  approvedSources: readonly SourceDescriptor[],
): string[] => {
  const info = payload.research_information;
  return uniqueUrlsPreserveOrder(payloadUrls(info?.visited_urls)).filter((url) =>
    isAllowedSourceUrl(url, approvedSources),
  );
};

const collectRejectedUrlsFromPayload = (payload: WebResearchResponsePayload): string[] => {
  const rawRejected = payload.research_information?.rejected_source_urls;
  return Array.isArray(rawRejected)
    ? uniqueUrlsPreserveOrder(rawRejected.filter((value): value is string => typeof value === "string"))
    : [];
};

const MAX_ARCHIVE_PROBE_EVENTS = 28;

const emitArchiveProbeEvents = (
  payload: WebResearchResponsePayload,
  approvedSources: readonly SourceDescriptor[],
  onProgress?: (event: WebResearchProgressEvent) => void,
): void => {
  if (!onProgress) return;

  const urls = collectVisitedUrlsFromPayload(payload, approvedSources).slice(0, MAX_ARCHIVE_PROBE_EVENTS * 2);

  let emitted = 0;
  for (const url of urls) {
    if (emitted >= MAX_ARCHIVE_PROBE_EVENTS) break;
    const matched = matchApprovedSource(url, approvedSources);
    const host = hostnameHint(url);
    onProgress({
      phase: "gather",
      detail: matched ? `Facet · ${matched.name}` : `Touch · ${host}`,
      ...(matched ? { sources: [matched] } : {}),
    });
    emitted++;
  }
};

const matchApprovedSource = (
  url: string,
  approvedSources: readonly SourceDescriptor[],
): SourceDescriptor | undefined => {
  const candidate = normalizeUrl(url);

  return approvedSources.find((source) => {
    const homeUrl = normalizeUrl(source.homeUrl);
    return candidate === homeUrl || candidate.startsWith(`${homeUrl}/`);
  });
};

const sourceUrlLabel = (source: SourceDescriptor, url: string): string => {
  try {
    const exact = new URL(url);
    const base = new URL(source.homeUrl);
    const exactPath = decodeURIComponent(stripTrailingSlashes(exact.pathname));
    const basePath = decodeURIComponent(stripTrailingSlashes(base.pathname));
    if (exactPath === basePath) return source.name;
    const relativePath = exactPath.startsWith(`${basePath}/`) ? exactPath.slice(basePath.length + 1) : exactPath;
    const cleaned = relativePath
      .replace(/^blob\/[^/]+\//u, "")
      .replace(/^tree\/[^/]+\//u, "")
      .replace(/^wiki\//u, "")
      .split("/")
      .filter(Boolean)
      .slice(-2)
      .join("/")
      .replace(/[-_]+/gu, " ")
      .trim();
    if (!cleaned) return source.name;
    const lineAnchor = exact.hash && /^#L\d+(?:-L\d+)?$/iu.test(exact.hash) ? exact.hash : "";
    return `${source.name}: ${cleaned}${lineAnchor}`;
  } catch {
    return source.name;
  }
};

const exactSourceFromUrl = (url: string, approvedSources: readonly SourceDescriptor[]): SourceDescriptor | undefined => {
  const exactUrl = normalizeUrl(url);
  const catalogMatch = matchApprovedSource(url, approvedSources);
  if (catalogMatch) {
    const sourceUrl = normalizeUrl(catalogMatch.homeUrl);
    return {
      ...catalogMatch,
      id: exactUrl === sourceUrl ? catalogMatch.id : `${catalogMatch.id}:${exactUrl}`,
      name: sourceUrlLabel(catalogMatch, exactUrl),
      homeUrl: exactUrl,
    };
  }
  if (!isTraskApprovedBaseUrl(url)) return undefined;
  const host = hostnameHint(url);
  return {
    id: `approved-web:${exactUrl}`,
    name: host,
    kind: "website",
    homeUrl: exactUrl,
    description: `Approved web source (${host})`,
    freshnessPolicy: "live web research",
    approvalScope: "approved research host",
    tags: [host],
  };
};

const isCatalogRootUrl = (url: string, approvedSources: readonly SourceDescriptor[]): boolean => {
  const normalized = normalizeUrl(url);
  return approvedSources.some((source) => normalizeUrl(source.homeUrl) === normalized);
};

const materializeSourcesFromUrls = (
  urls: readonly string[],
  sourcePool: readonly SourceDescriptor[],
): readonly SourceDescriptor[] => {
  const candidateUrls = uniqueUrlsPreserveOrder(
    urls.filter((url) => isAllowedSourceUrl(url, sourcePool)),
  );

  const matched: SourceDescriptor[] = [];
  const hasPreciseUrl = candidateUrls.some((url) => !isCatalogRootUrl(url, sourcePool));

  for (const url of candidateUrls) {
    if (hasPreciseUrl && isCatalogRootUrl(url, sourcePool)) continue;
    const source = exactSourceFromUrl(url, sourcePool);

    if (source && !matched.some((entry) => normalizeUrl(entry.homeUrl) === normalizeUrl(source.homeUrl))) {
      matched.push(source);
    }
  }

  return matched.slice(0, 6);
};

const collectCitedSources = (
  report: string,
  approvedSources: readonly SourceDescriptor[],
  payload: WebResearchResponsePayload,
): readonly SourceDescriptor[] => {
  const info = payload.research_information;
  return materializeSourcesFromUrls([
    ...extractSourceSectionUrls(report),
    ...payloadUrls(info?.cited_urls),
    ...payloadUrls(info?.source_urls),
  ], approvedSources);
};

const collectRetrievedSources = (
  report: string,
  approvedSources: readonly SourceDescriptor[],
  payload: WebResearchResponsePayload,
): readonly SourceDescriptor[] => {
  const info = payload.research_information;
  return materializeSourcesFromUrls([
    ...payloadUrls(info?.retrieved_urls),
    ...payloadUrls(info?.cited_urls),
    ...payloadUrls(info?.source_urls),
    ...extractSourceSectionUrls(report),
  ], approvedSources);
};

const collectCitedSourcesFromText = (
  text: string,
  sourcePool: readonly SourceDescriptor[],
): readonly SourceDescriptor[] => materializeSourcesFromUrls(extractSourceSectionUrls(text), sourcePool);

const startsWithTableOfContentsHeading = (trimmed: string): boolean => {
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("##")) return false;
  let i = 2;
  while (i < lower.length && /\s/u.test(lower[i]!)) i += 1;
  return lower.startsWith("table of contents", i);
};

/** `##` at line start followed by Unicode whitespace (matches prior `^##\\s+` checks). */
const startsWithH2WithSpace = (trimmed: string): boolean =>
  trimmed.startsWith("##") && trimmed.length > 2 && /\s/u.test(trimmed[2]!);

/** Single-level ATX heading: `# ` but not `## …` (H1 title line). */
const isH1AtxHeadingLine = (trimmed: string): boolean => {
  if (!trimmed.startsWith("#")) return false;
  if (trimmed.startsWith("##")) return false;
  return trimmed.length > 1 && /\s/u.test(trimmed[1]!);
};

const normalizeReport = (value: string): string => {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let skippingToc = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (startsWithTableOfContentsHeading(trimmed)) {
      skippingToc = true;
      continue;
    }
    if (skippingToc) {
      if (
        startsWithH2WithSpace(trimmed)
        || isSourcesHeadingLine(line)
        || isH1AtxHeadingLine(trimmed)
      ) {
        skippingToc = false;
      } else {
        continue;
      }
    }
    if (isH1AtxHeadingLine(trimmed)) continue;
    out.push(line);
  }
  return collapseExcessiveNewlines(out.join("\n"));
};

const formatSourcesSection = (sources: readonly SourceDescriptor[]): string => {
  return [
    "Sources",
    ...sources.map((source, index) => `${index + 1}. ${source.name} - ${source.homeUrl}`),
  ].join("\n");
};

const countPayloadWebUrls = (payload: WebResearchResponsePayload): number => {
  const info = payload.research_information;
  const urls = uniqueUrlsPreserveOrder([
    ...payloadUrls(info?.cited_urls),
    ...payloadUrls(info?.retrieved_urls),
    ...payloadUrls(info?.visited_urls),
    ...payloadUrls(info?.source_urls),
  ]);
  return urls.filter((url) => isPublicWebCitationUrl(url)).length;
};

const LEGACY_APPROVED_ARCHIVE_BULLET_MARKER =
  "is an approved archive page that may answer questions about";

/**
 * Legacy failure copy used a markdown bullet whose tail contained a fixed phrase.
 * Implemented without `.*`-style regexes to avoid polynomial backtracking on adversarial input.
 */
const hasLegacyApprovedArchiveFailureBullet = (normalized: string): boolean => {
  const lower = normalized.toLowerCase();
  const marker = LEGACY_APPROVED_ARCHIVE_BULLET_MARKER.toLowerCase();
  if (!lower.startsWith("-")) return false;
  let i = 1;
  while (i < lower.length && /\s/u.test(lower[i]!)) i += 1;
  if (i >= lower.length || /\s/u.test(lower[i]!)) return false;
  while (i < lower.length && /\S/u.test(lower[i]!)) i += 1;
  return lower.indexOf(marker, i) !== -1;
};

const isSynthesisFailureReport = (report: string, payload: WebResearchResponsePayload): boolean => {
  const normalized = report.trim();
  const webUrlCount = countPayloadWebUrls(payload);
  if (webUrlCount >= MIN_HOLOCRON_WEB_CITATIONS) {
    return /^i could not complete live archive synthesis\b/iu.test(normalized);
  }
  if (/^i could not complete live archive synthesis\b/iu.test(normalized)) {
    return true;
  }
  if (hasLegacyApprovedArchiveFailureBullet(normalized)) {
    return true;
  }
  return false;
};

const sourceOnlyFallbackAnswer = (query: string, sources: readonly SourceDescriptor[]): string => {
  if (sources.length === 0) return "I could not complete live archive synthesis for this question right now.";
  const topic = stripTrailingQuestionMarks(query) || "this question";
  return [
    `I found candidate sources for ${topic}, but I could not support a grounded answer from the retrieved evidence.`,
    "Review the sources below or try a narrower wording.",
    "",
    formatSourcesSection(sources),
  ].join("\n");
};

const DEFAULT_REWRITE_TIMEOUT_MS = 15_000;
const MAX_REWRITE_ATTEMPTS = 2;

const normalizePreferredRewriteModel = (model: string | undefined): string | undefined => {
  const trimmed = model?.trim();
  if (!trimmed) return undefined;
  if (trimmed.startsWith("litellm:")) return trimmed.slice("litellm:".length).trim() || undefined;
  if (trimmed.startsWith("openrouter:")) return trimmed.slice("openrouter:".length).trim() || undefined;
  return trimmed;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`rewrite timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

const fallbackDiscordRewrite = (
  query: string,
  report: string,
  sources: readonly SourceDescriptor[],
): string => {
  if (sources.length === 0) {
    return degradedAnswerFallback(query, sources);
  }
  const normalized = normalizeReport(report);
  if (/^i could not complete live archive synthesis\b/iu.test(normalized)) {
    return sourceOnlyFallbackAnswer(query, sources);
  }

  const sourceIndexByUrl = new Map<string, number>(
    sources.map((source, index) => [normalizeUrl(source.homeUrl), index + 1]),
  );

  const bodyOnly = collapseExcessiveNewlines(
    stripAsteriskRuns(
      stripMarkdownTableRows(
        stripMarkdownHeaders(
          rewriteMarkdownLinks(splitAtSourcesHeading(normalized), (text, url) => {
            const matchedSource = matchApprovedSource(url, sources);
            const citationIndex = matchedSource ? sourceIndexByUrl.get(normalizeUrl(matchedSource.homeUrl)) : undefined;
            return citationIndex ? `${text} [${citationIndex}]` : text;
          }),
        ),
      ),
    ),
  );

  const paragraphs = splitParagraphs(bodyOnly);

  const selected: string[] = [];
  let totalLength = 0;

  for (const paragraph of paragraphs) {
    if (selected.length >= 2) break;
    if (totalLength + paragraph.length > 900 && selected.length > 0) break;
    selected.push(paragraph);
    totalLength += paragraph.length;
  }

  let summary = selected.join("\n\n").trim();

  if (!summary) {
    summary = bodyOnly.slice(0, 900).trim();
  }

  if (sources.length > 0 && !/\[\d+\]/.test(summary)) {
    summary = `${summary} [1]`.trim();
  }

  return sources.length > 0 ? `${summary}\n\n${formatSourcesSection(sources)}` : summary;
};

const fallbackDiscordBrief = (query: string, report: string, sources: readonly SourceDescriptor[]): string => {
  if (sources.length === 0) {
    return degradedAnswerFallback(query, sources);
  }
  const normalized = normalizeReport(report);
  if (/^i could not complete live archive synthesis\b/iu.test(normalized)) {
    return sourceOnlyFallbackAnswer(query, sources);
  }

  const sourceIndexByUrl = new Map<string, number>(
    sources.map((source, index) => [normalizeUrl(source.homeUrl), index + 1]),
  );

  const bodyOnly = collapseExcessiveNewlines(
    stripAsteriskRuns(
      stripMarkdownHeaders(
        rewriteMarkdownLinks(splitAtSourcesHeading(normalized), (text, url) => {
          const matchedSource = matchApprovedSource(url, sources);
          const citationIndex = matchedSource ? sourceIndexByUrl.get(normalizeUrl(matchedSource.homeUrl)) : undefined;
          return citationIndex ? `${text} [${citationIndex}]` : text;
        }),
      ),
    ),
  );

  const firstChunk = splitParagraphs(bodyOnly)[0] ?? bodyOnly;
  let summary = firstChunk.slice(0, 420).trim();

  if (!summary) {
    summary = bodyOnly.slice(0, 420).trim();
  }

  if (sources.length > 0 && !/\[\d+\]/.test(summary)) {
    summary = `${summary} [1]`.trim();
  }

  return sources.length > 0 ? `${summary}\n\n${formatSourcesSection(sources)}` : summary;
};

const degradedAnswerFallback = (_query: string, _approvedSources: readonly SourceDescriptor[]): string => {
  return "I could not complete live archive synthesis for this question right now.";
};

const normalizePreferenceUrl = (url: string): URL | undefined => {
  try {
    return new URL(stripTrailingSlashes(url.trim()));
  } catch {
    return undefined;
  }
};

const preferenceMatchesSource = (preference: WebResearchSourcePreference, source: SourceDescriptor): boolean => {
  const preferenceUrl = normalizePreferenceUrl(preference.url);
  const sourceUrl = normalizePreferenceUrl(source.homeUrl);

  if (preferenceUrl && sourceUrl) {
    const preferenceHost = preferenceUrl.hostname.replace(/^www\./, "").toLowerCase();
    const sourceHost = sourceUrl.hostname.replace(/^www\./, "").toLowerCase();
    const preferencePath = stripTrailingSlashes(preferenceUrl.pathname);
    const sourcePath = stripTrailingSlashes(sourceUrl.pathname);

    if (preferenceHost === sourceHost && (preferencePath === "" || sourcePath === preferencePath || sourcePath.startsWith(`${preferencePath}/`))) {
      return true;
    }

    if (preferenceHost === sourceHost && preferenceUrl.pathname === "/") {
      return true;
    }
  }

  const preferenceName = preference.name?.trim().toLowerCase();
  return Boolean(preferenceName && preferenceName === source.name.trim().toLowerCase());
};

const applySourcePreferences = (
  approvedSources: readonly SourceDescriptor[],
  preferences?: readonly WebResearchSourcePreference[],
): readonly SourceDescriptor[] => {
  if (!preferences?.length) return approvedSources;

  const ranked = approvedSources
    .map((source, index) => {
      const preference = preferences.find((entry) => preferenceMatchesSource(entry, source));
      return {
        source,
        index,
        enabled: preference ? preference.enabled : true,
        weight: preference && Number.isFinite(preference.weight) ? preference.weight : 1,
      };
    })
    .filter((entry) => entry.enabled)
    .sort((left, right) => right.weight - left.weight || left.index - right.index)
    .map((entry) => entry.source);

  return ranked;
};

type ResearchQueryIntent = "tooling" | "technical" | "lore" | "general";

const TOOLING_QUERY_TERMS = [
  "mdlops",
  "mdledit",
  "kotormax",
  "kotorblender",
  "pykotor",
  "xoreos",
  "reone",
  "tslpatcher",
  "toolchain",
  "modding",
  "tool",
  "script",
  "gff",
  "2da",
  "tlk",
  "nss",
  "ncs",
  "utc",
  "uti",
  "mdl",
  "mdx",
  "texture",
  "convert",
  "blender",
  "3ds",
];

const TECHNICAL_QUERY_TERMS = [
  "widescreen",
  "resolution",
  "hud",
  "screen",
  "crash",
  "compatibility",
  "steam",
  "windows",
  "linux",
  "mac",
  "save",
  "saves",
  "install",
  "launcher",
  "driver",
  "movies",
  "cutscene",
  "graphics",
  "aspect",
];

const LORE_QUERY_TERMS = [
  "bastila",
  "revan",
  "malak",
  "shan",
  "jedi",
  "sith",
  "rakata",
  "star forge",
  "temple summit",
  "companion",
  "romance",
  "story",
  "lore",
];

const LORE_SOURCE_IDS = new Set(["wikipedia-kotor", "strategywiki-kotor"]);

const queryIncludesAny = (query: string, terms: readonly string[]): boolean => {
  const lowered = query.toLowerCase();
  return terms.some((term) => lowered.includes(term));
};

const classifyQueryIntent = (query: string): ResearchQueryIntent => {
  const lowered = query.toLowerCase();
  if (queryIncludesAny(lowered, TOOLING_QUERY_TERMS)) return "tooling";
  if (queryIncludesAny(lowered, TECHNICAL_QUERY_TERMS)) return "technical";
  if (queryIncludesAny(lowered, LORE_QUERY_TERMS)) return "lore";
  return "general";
};

const routeSourcesForQuery = (
  query: string,
  approvedSources: readonly SourceDescriptor[],
): readonly SourceDescriptor[] => {
  const intent = classifyQueryIntent(query);
  if (intent === "tooling" || intent === "technical") {
    const filtered = approvedSources.filter((source) => !LORE_SOURCE_IDS.has(source.id));
    return filtered.length > 0 ? filtered : approvedSources;
  }
  if (intent === "lore") {
    return [
      ...approvedSources.filter((source) => LORE_SOURCE_IDS.has(source.id)),
      ...approvedSources.filter((source) => !LORE_SOURCE_IDS.has(source.id)),
    ];
  }
  return approvedSources;
};

const mergeSourcesPreserveOrder = (...groups: readonly (readonly SourceDescriptor[])[]): SourceDescriptor[] => {
  const merged: SourceDescriptor[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const source of group) {
      const key = normalizeUrl(source.homeUrl);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(source);
    }
  }
  return merged;
};

const normalizeMatchToken = (token: string): string => {
  const lowered = token.toLowerCase();
  if (lowered.length <= 6) return lowered;
  return lowered.slice(0, 6);
};

const tokenizeQuery = (query: string): string[] =>
  [...new Set(
    query
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 4)
      .map(normalizeMatchToken),
  )];

/** Citations must be real public web pages on the approved allowlist (live web research only). */
const isPublicWebCitationUrl = (url: string): boolean => {
  if (url.startsWith("local://") || url.startsWith("discord://") || isDiscordCitationUrl(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const filterPublicWebCitationSources = (sources: readonly SourceDescriptor[]): SourceDescriptor[] =>
  sources.filter((source) => isPublicWebCitationUrl(source.homeUrl));

/** Holocron e2e and product policy: answers must ground on multiple approved web sources. */
export const MIN_HOLOCRON_WEB_CITATIONS = 2;

const collectWebEvidenceSources = (
  query: string,
  report: string,
  approvedSources: readonly SourceDescriptor[],
  payload: WebResearchResponsePayload,
): readonly SourceDescriptor[] => {
  const pool = mergeSourcesPreserveOrder(
    collectRetrievedSources(report, approvedSources, payload),
    collectCitedSources(report, approvedSources, payload),
    materializeSourcesFromUrls(collectVisitedUrlsFromPayload(payload, approvedSources), approvedSources),
  );
  return rerankEvidenceSources(query, filterPublicWebCitationSources(pool));
};

const ensureMinimumWebCitations = (
  query: string,
  cited: readonly SourceDescriptor[],
  evidence: readonly SourceDescriptor[],
  payload?: WebResearchResponsePayload,
  approvedSources: readonly SourceDescriptor[] = [],
): readonly SourceDescriptor[] => {
  const info = payload?.research_information;
  const payloadBacked = payload
    ? materializeSourcesFromUrls(
      uniqueUrlsPreserveOrder([
        ...payloadUrls(info?.cited_urls),
        ...payloadUrls(info?.retrieved_urls),
        ...payloadUrls(info?.visited_urls),
        ...payloadUrls(info?.source_urls),
      ]),
      approvedSources,
    )
    : [];

  const merged = rerankEvidenceSources(
    query,
    mergeSourcesPreserveOrder(cited, evidence, payloadBacked),
  );
  const webOnly = filterPublicWebCitationSources(merged);
  if (webOnly.length >= MIN_HOLOCRON_WEB_CITATIONS) {
    return webOnly.slice(0, 8);
  }
  const padded = rerankEvidenceSources(
    query,
    mergeSourcesPreserveOrder(webOnly, filterPublicWebCitationSources(evidence), payloadBacked),
  );
  return padded.length >= MIN_HOLOCRON_WEB_CITATIONS
    ? padded.slice(0, 8)
    : filterPublicWebCitationSources(payloadBacked).slice(0, 8);
};

const composeAnswerFromWebSources = (query: string, sources: readonly SourceDescriptor[]): string => {
  const webSources = filterPublicWebCitationSources(sources).slice(0, 5);
  if (webSources.length === 0) {
    return sourceOnlyFallbackAnswer(query, sources);
  }
  return sourceOnlyFallbackAnswer(query, webSources);
};

const sourceMatchesQuery = (source: SourceDescriptor, query: string): boolean => {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return false;
  const haystack = `${source.name} ${source.description ?? ""} ${source.homeUrl}`.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits += 1;
  }
  return hits >= Math.min(2, tokens.length);
};

const sourceRelevanceScore = (source: SourceDescriptor, query: string): number => {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return 1;
  const haystack = [
    source.name,
    source.description,
    source.homeUrl,
    ...(source.tags ?? []),
  ].join(" ").toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits += 1;
  }
  const titleBonus = tokens.some((token) => source.name.toLowerCase().includes(token)) ? 2 : 0;
  const urlBonus = tokens.some((token) => source.homeUrl.toLowerCase().includes(token)) ? 1 : 0;
  return hits * 2 + titleBonus + urlBonus;
};

const rerankEvidenceSources = (query: string, sources: readonly SourceDescriptor[]): readonly SourceDescriptor[] => {
  const tokens = tokenizeQuery(query);
  const ranked = sources
    .map((source, index) => ({
      source,
      index,
      score: sourceRelevanceScore(source, query),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index);
  if (tokens.length === 0) {
    return ranked.map((entry) => entry.source).slice(0, 4);
  }
  const strong = ranked.filter((entry) => entry.score >= 2).map((entry) => entry.source);
  return strong.slice(0, 8);
};

const resolveWebSourcesForFailedSynthesis = (
  query: string,
  retrievedSources: readonly SourceDescriptor[],
): readonly SourceDescriptor[] => {
  const candidates = filterPublicWebCitationSources(retrievedSources);
  const matched = candidates.filter((source) => sourceMatchesQuery(source, query));
  return (matched.length > 0 ? matched : candidates).slice(0, 5);
};

const researchDomainsForSources = (sources: readonly SourceDescriptor[]): string[] => {
  const enabledHosts = new Set<string>();
  for (const source of sources) {
    try {
      const host = new URL(source.homeUrl).hostname.replace(/^www\./, "").toLowerCase();
      const baseHost = traskApprovedResearchBaseHosts.find((base) => host === base || host.endsWith(`.${base}`));
      if (baseHost) enabledHosts.add(baseHost);
    } catch {
      continue;
    }
  }
  return [...enabledHosts];
};

const HEARTBEAT_MS = 8000;

const withProgressHeartbeat = async <T>(
  phase: WebResearchProgressEvent["phase"],
  makeDetail: (elapsedMs: number) => string,
  onProgress: ((event: WebResearchProgressEvent) => void) | undefined,
  work: () => Promise<T>,
): Promise<T> => {
  if (!onProgress) {
    return await work();
  }

  const startedAt = Date.now();
  let lastBucket = -1;
  const emit = () => {
    const elapsed = Date.now() - startedAt;
    const bucket = Math.floor(elapsed / HEARTBEAT_MS);
    if (bucket === lastBucket) return;
    lastBucket = bucket;
    onProgress({ phase, detail: makeDetail(elapsed) });
  };

  emit();
  const timer = setInterval(emit, HEARTBEAT_MS);
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
};

export class WebResearchClient implements WebResearchQueryHandler {
  private readonly openAiClient: OpenAI | null;

  public constructor(
    private readonly config: WebResearchRuntimeConfig,
    private readonly aiConfig: SharedAiConfig,
    private readonly approvedSources: readonly SourceDescriptor[] = traskApprovedResearchSources,
    private readonly factoryOptions: WebResearchClientFactoryOptions = {},
  ) {
    this.openAiClient = aiConfig.openAiApiKey
      ? new OpenAI({
          apiKey: aiConfig.openAiApiKey,
          ...(aiConfig.openAiBaseUrl ? { baseURL: aiConfig.openAiBaseUrl } : {}),
          ...(aiConfig.openAiDefaultHeaders ? { defaultHeaders: aiConfig.openAiDefaultHeaders } : {}),
        })
      : null;
  }

  public async listModels(): Promise<readonly WebResearchModelOption[]> {
    try {
      const dynamicModels = await listHeadlessWebResearchModels(this.config);
      const seen = new Set(DEFAULT_WEB_RESEARCH_MODELS.map((model) => model.id));
      return [
        ...DEFAULT_WEB_RESEARCH_MODELS,
        ...dynamicModels.filter((model) => {
          if (seen.has(model.id)) return false;
          seen.add(model.id);
          return true;
        }),
      ];
    } catch {
      return DEFAULT_WEB_RESEARCH_MODELS;
    }
  }

  private async rewriteForDiscord(
    query: string,
    report: string,
    approvedSources: readonly SourceDescriptor[],
    preferredModel?: string,
    communityDigest = "",
  ): Promise<string> {
    if (!this.openAiClient) {
      return fallbackDiscordRewrite(query, report, approvedSources);
    }

    const allowedSources = approvedSources
      .map((source, index) => `${index + 1}. ${source.name} - ${source.homeUrl}`)
      .join("\n");

    const preferredRewriteModel = normalizePreferredRewriteModel(preferredModel);
    const modelsToTry = [
      ...new Set([...(preferredRewriteModel ? [preferredRewriteModel] : []), this.aiConfig.chatModel, ...this.aiConfig.chatModelFallbacks]),
    ].slice(0, MAX_REWRITE_ATTEMPTS);

    for (const model of modelsToTry) {
      try {
        const completion = await withTimeout(
          this.openAiClient.chat.completions.create({
            model,
            temperature: 0.2,
            messages: [
              {
                role: "system",
                content: [
                  "Rewrite research reports into concise Discord answers.",
                  "Do not mention research steps, indexing, tooling, or backend behavior.",
                  "Use only the numbered sources provided by the user.",
                  "Return plain Markdown with no headings except the final Sources heading.",
                ].join(" "),
              },
              {
                role: "user",
                content: [
                  `Question: ${query}`,
                  "Write a concise answer for Discord.",
                  "Requirements:",
                  "- Lead with the answer.",
                  "- Use at most 3 short paragraphs or 5 compact bullets before sources.",
                  "- Use inline numeric citations like [1], [2].",
                  ' - End with the exact heading "Sources" on its own line.',
                  "- Under Sources, include only the cited sources using the exact numbered lines provided below.",
                  "Allowed Sources:",
                  allowedSources,
                  ...(communityDigest ? ["Community context (lower authority than web archives):", communityDigest] : []),
                  "Research Report:",
                  report,
                ].join("\n\n"),
              },
            ],
          }),
          DEFAULT_REWRITE_TIMEOUT_MS,
        );

        const rewritten = completion.choices[0]?.message?.content?.trim();

        if (rewritten && /\nSources\s*\n/i.test(rewritten)) {
          return rewritten;
        }
      } catch {
        continue;
      }
    }

    return fallbackDiscordRewrite(query, report, approvedSources);
  }

  private async resolveLocalHits(
    query: string,
    options: WebResearchQueryOptions | undefined,
    onProgress?: (event: WebResearchProgressEvent) => void,
  ): Promise<readonly SearchHit[]> {
    const prefetched = options?.localHits?.filter((hit) => hit.url.trim()) ?? [];
    if (prefetched.length > 0) {
      return prefetched;
    }

    const provider = this.factoryOptions.localSearchProvider;
    if (!provider) {
      return [];
    }

    onProgress?.({
      phase: "gather",
      detail: "Searching imported server history…",
    });

    try {
      return await provider.search(query, 6);
    } catch {
      return [];
    }
  }

  private async rewriteForDiscordBrief(
    query: string,
    report: string,
    approvedSources: readonly SourceDescriptor[],
  ): Promise<string> {
    if (!this.openAiClient) {
      return fallbackDiscordBrief(query, report, approvedSources);
    }

    const allowedSources = approvedSources
      .map((source, index) => `${index + 1}. ${source.name} - ${source.homeUrl}`)
      .join("\n");

    const modelsToTry = [...new Set([this.aiConfig.chatModel, ...this.aiConfig.chatModelFallbacks])].slice(0, MAX_REWRITE_ATTEMPTS);

    for (const model of modelsToTry) {
      try {
        const completion = await withTimeout(
          this.openAiClient.chat.completions.create({
            model,
            temperature: 0.15,
            max_tokens: 380,
            messages: [
              {
                role: "system",
                content: [
                  "Rewrite research into a very short Discord chat reply (like a quick DM).",
                  "No preamble, no essay tone, no meta commentary about research.",
                  "Use only the numbered sources provided.",
                  "Plain sentences; at most 2 short sentences OR up to 3 compact bullets before Sources.",
                  'End with the exact heading "Sources" on its own line, then cited sources only.',
                ].join(" "),
              },
              {
                role: "user",
                content: [
                  `Question: ${query}`,
                  "Write the shortest helpful answer.",
                  "Allowed Sources:",
                  allowedSources,
                  "Research Report:",
                  report,
                ].join("\n\n"),
              },
            ],
          }),
          DEFAULT_REWRITE_TIMEOUT_MS,
        );

        const rewritten = completion.choices[0]?.message?.content?.trim();

        if (rewritten && /\nSources\s*\n/i.test(rewritten)) {
          return rewritten;
        }
      } catch {
        continue;
      }
    }

    return fallbackDiscordBrief(query, report, approvedSources);
  }

  private async fetchResearchReport(
    query: string,
    customPrompt: string,
    approvedSources: readonly SourceDescriptor[],
    options?: WebResearchQueryOptions,
  ): Promise<{ report: string; payload: WebResearchResponsePayload }> {
    if (approvedSources.length === 0) {
      throw new Error("No approved research sources are enabled.");
    }

    const allowedDomains = researchDomainsForSources(approvedSources);
    const raw = await runHeadlessWebResearch(this.config, {
      query: buildResearchTask(query),
      custom_prompt: customPrompt,
      source_urls: approvedSources.map((source) => source.homeUrl),
      query_domains: allowedDomains,
      allowed_url_prefixes: approvedSources.map((source) => source.homeUrl),
      ...(options?.model?.trim() ? { model: options.model.trim() } : {}),
      report_type: "research_report",
      report_source: "web",
    });

    const payload: WebResearchResponsePayload = {
      report: raw.report,
      ...(raw.research_information !== undefined
        ? { research_information: { ...raw.research_information } }
        : {}),
    };

    const report = typeof raw.report === "string" ? normalizeReport(raw.report) : "";

    if (!report) {
      throw new Error("Trask web research returned an empty report.");
    }

    return { report, payload };
  }

  public async answerQuestion(
    query: string,
    onProgress?: (event: WebResearchProgressEvent) => void,
    options?: WebResearchQueryOptions,
  ): Promise<WebResearchAnswer> {
    const approvedSources = routeSourcesForQuery(
      query,
      applySourcePreferences(this.approvedSources, options?.sourcePreferences),
    );
    try {
      const localHits = await this.resolveLocalHits(query, options, onProgress);
      const communitySources = searchHitsToCommunitySources(localHits);
      const communityDigest = buildCommunityKnowledgeDigest(localHits);
      if (localHits.length > 0) {
        onProgress?.({
          phase: "gather",
          detail: `Found ${localHits.length} relevant message${localHits.length === 1 ? "" : "s"} in server history…`,
        });
      }

      const allowedDomains = researchDomainsForSources(approvedSources);
      onProgress?.({
        phase: "gather",
        detail: `Scanning ${approvedSources.length} approved source root${approvedSources.length === 1 ? "" : "s"} across ${allowedDomains.length} host${allowedDomains.length === 1 ? "" : "s"}…`,
      });
      const { report, payload } = await withProgressHeartbeat(
        "gather",
        (elapsedMs) => {
          const seconds = Math.max(1, Math.floor(elapsedMs / 1000));
          return `Researching approved archive sources… (${seconds}s)`;
        },
        onProgress,
        async () => await this.fetchResearchReport(query, buildCustomPrompt(), approvedSources, options),
      );
      const rejectedUrls = collectRejectedUrlsFromPayload(payload);
      if (rejectedUrls.length > 0) {
        onProgress?.({
          phase: "gather",
          detail: `Rejected ${rejectedUrls.length} URL${rejectedUrls.length === 1 ? "" : "s"} outside approved source roots.`,
        });
      }
      emitArchiveProbeEvents(payload, approvedSources, onProgress);
      onProgress?.({
        phase: "report",
        detail: "Ranking passages and citations…",
      });
      const webEvidenceSources = collectWebEvidenceSources(query, report, approvedSources, payload);
      const retrievedSources = mergeCommunityAndWebSources(webEvidenceSources, communitySources);
      const citedSourcesFromReport = rerankEvidenceSources(
        query,
        mergeSourcesPreserveOrder(
          collectCitedSources(report, approvedSources, payload),
          collectCitedSourcesFromText(report, approvedSources),
        ),
      );
      onProgress?.({
        phase: "sources",
        detail: retrievedSources.length ? `${retrievedSources.length} sources retrieved` : "Mapping hosts to archive catalog…",
        sources: retrievedSources,
      });
      onProgress?.({
        phase: "compose",
        detail: "Rendering Holocron answer…",
      });
      const sourcesForRewrite = mergeCommunityAndWebSources(
        filterWebArchiveCitationSources(retrievedSources),
        communitySources,
      );
      const webSourcesForRewrite = filterPublicWebCitationSources(sourcesForRewrite);

      let answer: string;
      if (webSourcesForRewrite.length === 0 && communitySources.length === 0) {
        answer = degradedAnswerFallback(query, approvedSources);
      } else if (isSynthesisFailureReport(report, payload)) {
        const webSources = resolveWebSourcesForFailedSynthesis(query, webEvidenceSources);
        if (webSources.length >= MIN_HOLOCRON_WEB_CITATIONS) {
          const rewritePool = mergeCommunityAndWebSources(
            filterPublicWebCitationSources(webSources),
            communitySources,
          );
          answer = this.openAiClient
            ? await this.rewriteForDiscord(query, report, rewritePool, options?.model, communityDigest)
            : fallbackDiscordRewrite(query, report, rewritePool);
        } else if (webSources.length > 0 || communitySources.length > 0) {
          answer = sourceOnlyFallbackAnswer(query, sourcesForRewrite);
        } else {
          answer = degradedAnswerFallback(query, approvedSources);
        }
      } else if (this.openAiClient) {
        answer = await this.rewriteForDiscord(
          query,
          report,
          sourcesForRewrite,
          options?.model,
          communityDigest,
        );
      } else {
        answer = fallbackDiscordRewrite(
          query,
          report,
          sourcesForRewrite,
        );
      }

      const webCitedSources = ensureMinimumWebCitations(
        query,
        filterPublicWebCitationSources(
          mergeSourcesPreserveOrder(
            collectCitedSourcesFromText(answer, retrievedSources),
            citedSourcesFromReport,
          ),
        ),
        webEvidenceSources,
        payload,
        approvedSources,
      );
      const communityCited = collectCitedSourcesFromText(answer, communitySources).filter(
        (source) => isDiscordCitationUrl(source.homeUrl),
      );
      const citedSources = mergeCommunityAndWebSources(webCitedSources, communityCited);

      return {
        answer,
        approvedSources: citedSources,
        retrievedSources,
        visitedUrls: collectVisitedUrlsFromPayload(payload, approvedSources),
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      onProgress?.({
        phase: "compose",
        detail: `Live web research failed: ${detail.slice(0, 240)}`,
      });
      const topic = stripTrailingQuestionMarks(query) || "this question";
      return {
        answer: `I could not complete live web research for "${topic}" right now (${detail}). Run scripts/bootstrap_trask_research.sh, set TRASK_WEB_RESEARCH_PYTHON, OPENAI_API_KEY or OPENROUTER_API_KEY, and TRASK_WEB_RESEARCH_TIMEOUT_MS, then retry.`,
        approvedSources: [],
        retrievedSources: [],
        visitedUrls: [],
      };
    }
  }

  /** Shorter rewrite for proactive/channel replies (still source-backed). */
  public async answerQuestionBrief(query: string): Promise<WebResearchBriefAnswer> {
    try {
      const approvedSources = routeSourcesForQuery(query, this.approvedSources);
      const { report, payload } = await this.fetchResearchReport(query, buildCustomPromptBrief(), approvedSources);
      const webEvidenceSources = collectWebEvidenceSources(query, report, approvedSources, payload);
      const retrievedSources = webEvidenceSources;
      const answer = retrievedSources.length > 0
        ? await this.rewriteForDiscordBrief(query, report, retrievedSources)
        : degradedAnswerFallback(query, approvedSources);

      return {
        answer,
        approvedSources: ensureMinimumWebCitations(
          query,
          filterPublicWebCitationSources(
            mergeSourcesPreserveOrder(
              collectCitedSourcesFromText(answer, retrievedSources),
              collectCitedSources(report, approvedSources, payload),
            ),
          ),
          webEvidenceSources,
          payload,
          approvedSources,
        ),
        retrievedSources,
        visitedUrls: collectVisitedUrlsFromPayload(payload, approvedSources),
        researchReport: report,
      };
    } catch {
      const topic = stripTrailingQuestionMarks(query) || "this question";
      const answer = `I could not complete live web research for "${topic}" right now.`;
      return {
        answer,
        approvedSources: [],
        retrievedSources: [],
        visitedUrls: [],
        researchReport: answer,
      };
    }
  }
}

export const createWebResearchClient = (
  config: WebResearchRuntimeConfig,
  aiConfig: SharedAiConfig = loadSharedAiConfig(),
  factoryOptions: WebResearchClientFactoryOptions = {},
): WebResearchClient => {
  return new WebResearchClient(config, aiConfig, traskApprovedResearchSources, factoryOptions);
};

// ---------------------------------------------------------------------------
// Pure helpers exported for unit testing — not part of the public API surface.
// ---------------------------------------------------------------------------
export {
  normalizeUrl as _normalizeUrl,
  extractUrls as _extractUrls,
  hostnameHint as _hostnameHint,
  uniqueUrlsPreserveOrder as _uniqueUrlsPreserveOrder,
  collectCitedSources as _collectCitedSources,
  collectRetrievedSources as _collectRetrievedSources,
  collectVisitedUrlsFromPayload as _collectVisitedUrlsFromPayload,
  collectCitedSourcesFromText as _collectCitedSourcesFromText,
  isSynthesisFailureReport as _isSynthesisFailureReport,
  countPayloadWebUrls as _countPayloadWebUrls,
  normalizeReport as _normalizeReport,
  formatSourcesSection as _formatSourcesSection,
  normalizePreferredRewriteModel as _normalizePreferredRewriteModel,
  matchApprovedSource as _matchApprovedSource,
  classifyQueryIntent as _classifyQueryIntent,
  routeSourcesForQuery as _routeSourcesForQuery,
};
