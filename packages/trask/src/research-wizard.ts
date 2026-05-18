import OpenAI from "openai";

import { loadSharedAiConfig, type ResearchWizardRuntimeConfig, type SharedAiConfig } from "@openkotor/config";
import {
  isTraskApprovedBaseUrl,
  isTraskApprovedResearchUrl,
  sourceUrlMatchesDescriptor,
  type SearchHit,
  type SearchProvider,
  traskApprovedResearchBaseHosts,
  traskApprovedResearchSources,
  type SourceDescriptor,
} from "@openkotor/retrieval";

import {
  listHeadlessGptResearcherModels,
  runHeadlessGptResearcher,
  type HeadlessAiResearchWizardModelOption,
} from "./gpt-researcher-subprocess.js";

export interface ResearchWizardAnswer {
  answer: string;
  /** Sources explicitly cited in the final answer shown to users. */
  approvedSources: readonly SourceDescriptor[];
  /** Sources retrieved as candidate evidence for the answer/rewrite stage. */
  retrievedSources: readonly SourceDescriptor[];
  /** Allowlisted URLs the headless researcher touched while gathering evidence. */
  visitedUrls: readonly string[];
}

export interface ResearchWizardBriefAnswer extends ResearchWizardAnswer {
  /** Normalized research report text used for proactive semantic gating. */
  researchReport: string;
}

/** Fine-grained phases for Holocron clients polling thread history. */
export interface ResearchWizardProgressEvent {
  phase: "gather" | "report" | "sources" | "compose";
  detail?: string;
  sources?: readonly SourceDescriptor[];
}

export interface ResearchWizardQueryOptions {
  /** Preferred ai-researchwizard model id, e.g. `openrouter:openrouter/auto` or `litellm:moonshotai/kimi-k2`. */
  model?: string;
  /** Optional per-request source enablement and weight hints from Holocron's Source Prioritization dialog. */
  sourcePreferences?: readonly ResearchWizardSourcePreference[];
}

export interface ResearchWizardSourcePreference {
  name?: string;
  url: string;
  weight: number;
  enabled: boolean;
}

export interface ResearchWizardModelOption extends HeadlessAiResearchWizardModelOption {}

/** Structural type for adapters that only need full Q&A (e.g. Trask HTTP `/ask`). */
export interface ResearchWizardQueryHandler {
  answerQuestion(
    query: string,
    onProgress?: (event: ResearchWizardProgressEvent) => void,
    options?: ResearchWizardQueryOptions,
  ): Promise<ResearchWizardAnswer>;
  listModels?(): Promise<readonly ResearchWizardModelOption[]>;
}

const DEFAULT_RESEARCH_WIZARD_MODELS: readonly ResearchWizardModelOption[] = [
  { id: "auto", label: "Auto", provider: "ResearchWizard fallback", recommended: true },
];

interface ResearchWizardResponsePayload {
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

const normalizeUrl = (value: string): string => value.replace(/\/+$/, "").trim();

const extractUrls = (value: string): string[] => {
  const matches = value.match(/[a-z][a-z0-9+.-]*:\/\/[^\s)>\]]+/giu) ?? [];
  return [...new Set(matches.map((match) => match.replace(/[.,;:!?]+$/, "")))];
};

const extractSourceSectionUrls = (value: string): string[] => {
  const normalized = value.replace(/\r\n/g, "\n");
  const sourceHeading = /\n(?:#{1,6}\s*)?(?:Sources|References)\s*\n/i;
  const match = normalized.match(sourceHeading);
  if (!match || match.index === undefined) {
    return extractUrls(normalized);
  }
  const sourceSection = normalized.slice(match.index + match[0].length);
  return extractUrls(sourceSection);
};

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

const isAllowedSourceUrl = (url: string, sourcePool: readonly SourceDescriptor[]): boolean =>
  sourcePool.some((source) => sourceUrlMatchesDescriptor(url, source)) || isTraskApprovedResearchUrl(url, sourcePool);

/** Visited URLs from ai-researchwizard payload (Holocron live facet pings). */
const collectVisitedUrlsFromPayload = (
  payload: ResearchWizardResponsePayload,
  approvedSources: readonly SourceDescriptor[],
): string[] => {
  const info = payload.research_information;
  return uniqueUrlsPreserveOrder(payloadUrls(info?.visited_urls)).filter((url) =>
    isAllowedSourceUrl(url, approvedSources),
  );
};

const collectRejectedUrlsFromPayload = (payload: ResearchWizardResponsePayload): string[] => {
  const rawRejected = payload.research_information?.rejected_source_urls;
  return Array.isArray(rawRejected)
    ? uniqueUrlsPreserveOrder(rawRejected.filter((value): value is string => typeof value === "string"))
    : [];
};

const MAX_ARCHIVE_PROBE_EVENTS = 28;

const emitArchiveProbeEvents = (
  payload: ResearchWizardResponsePayload,
  approvedSources: readonly SourceDescriptor[],
  onProgress?: (event: ResearchWizardProgressEvent) => void,
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
    const exactPath = decodeURIComponent(exact.pathname.replace(/\/+$/u, ""));
    const basePath = decodeURIComponent(base.pathname.replace(/\/+$/u, ""));
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
  const source = matchApprovedSource(url, approvedSources);
  if (!source) return undefined;
  const exactUrl = normalizeUrl(url);
  const sourceUrl = normalizeUrl(source.homeUrl);
  return {
    ...source,
    id: exactUrl === sourceUrl ? source.id : `${source.id}:${exactUrl}`,
    name: sourceUrlLabel(source, exactUrl),
    homeUrl: exactUrl,
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
  payload: ResearchWizardResponsePayload,
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
  payload: ResearchWizardResponsePayload,
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

const normalizeReport = (value: string): string => {
  return value
    .replace(/^#\s+.*$/m, "")
    .replace(/^##\s+Table of Contents[\s\S]*?(?=^##\s+|^Sources\s*$|^#\s+|$)/im, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const formatSourcesSection = (sources: readonly SourceDescriptor[]): string => {
  return [
    "Sources",
    ...sources.map((source, index) => `${index + 1}. ${source.name} - ${source.homeUrl}`),
  ].join("\n");
};

const isSynthesisFailureText = (report: string): boolean => {
  const normalized = report.trim();
  // Python synthesis failure (exact or query-specific wording).
  if (/^i could not complete live archive synthesis\b/iu.test(normalized)) {
    return true;
  }
  // Python's _build_report_from_urls fallback: every bullet is the "approved archive page" template.
  // This carries no real information — treat it as a synthesis failure so local knowledge takes priority.
  if (
    /^-\s+\S+.*is an approved archive page that may answer questions about/iu.test(normalized)
  ) {
    return true;
  }
  return false;
};

const sourceOnlyFallbackAnswer = (query: string, sources: readonly SourceDescriptor[]): string => {
  if (sources.length === 0) return "I could not complete live archive synthesis for this question right now.";
  const topic = query.trim().replace(/\?+$/u, "") || "this question";
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
  if (isSynthesisFailureText(normalized)) {
    return sourceOnlyFallbackAnswer(query, sources);
  }

  const sourceIndexByUrl = new Map<string, number>(
    sources.map((source, index) => [normalizeUrl(source.homeUrl), index + 1]),
  );

  const [bodyOnlyCandidate = ""] = normalized.split(/\n(?:#{1,6}\s*)?(?:Sources|References)\s*\n/i, 1);
  const bodyOnly = bodyOnlyCandidate
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_match, text: string, url: string) => {
      const matchedSource = matchApprovedSource(url, sources);
      const citationIndex = matchedSource ? sourceIndexByUrl.get(normalizeUrl(matchedSource.homeUrl)) : undefined;
      return citationIndex ? `${text} [${citationIndex}]` : text;
    })
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/^\|.*\|$/gm, "")
    .replace(/\*+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const paragraphs = bodyOnly
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

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
  if (isSynthesisFailureText(normalized)) {
    return sourceOnlyFallbackAnswer(query, sources);
  }

  const sourceIndexByUrl = new Map<string, number>(
    sources.map((source, index) => [normalizeUrl(source.homeUrl), index + 1]),
  );

  const [bodyOnlyCandidate = ""] = normalized.split(/\n(?:#{1,6}\s*)?(?:Sources|References)\s*\n/i, 1);
  const bodyOnly = bodyOnlyCandidate
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_match, text: string, url: string) => {
      const matchedSource = matchApprovedSource(url, sources);
      const citationIndex = matchedSource ? sourceIndexByUrl.get(normalizeUrl(matchedSource.homeUrl)) : undefined;
      return citationIndex ? `${text} [${citationIndex}]` : text;
    })
    .replace(/^#{1,6}\s+.*$/gm, "")
    .replace(/\*+/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const firstChunk = bodyOnly.split(/\n{2,}/)[0]?.trim() ?? bodyOnly;
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
    return new URL(url.trim().replace(/\/+$/, ""));
  } catch {
    return undefined;
  }
};

const preferenceMatchesSource = (preference: ResearchWizardSourcePreference, source: SourceDescriptor): boolean => {
  const preferenceUrl = normalizePreferenceUrl(preference.url);
  const sourceUrl = normalizePreferenceUrl(source.homeUrl);

  if (preferenceUrl && sourceUrl) {
    const preferenceHost = preferenceUrl.hostname.replace(/^www\./, "").toLowerCase();
    const sourceHost = sourceUrl.hostname.replace(/^www\./, "").toLowerCase();
    const preferencePath = preferenceUrl.pathname.replace(/\/+$/, "");
    const sourcePath = sourceUrl.pathname.replace(/\/+$/, "");

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
  preferences?: readonly ResearchWizardSourcePreference[],
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

interface LocalKnowledgePassage {
  title: string;
  text: string;
  url: string;
}

interface LocalKnowledgeContext {
  digest: string;
  passages: readonly LocalKnowledgePassage[];
  sources: readonly SourceDescriptor[];
}

const searchHitToSource = (hit: SearchHit): SourceDescriptor => {
  return {
    id: `${hit.sourceId}:${normalizeUrl(hit.url)}`,
    name: `${hit.sourceName}: ${hit.title}`,
    kind: hit.kind,
    homeUrl: hit.url,
    description: hit.snippet,
    freshnessPolicy: "imported knowledge snapshot",
    approvalScope: "local indexed archive",
    tags: hit.tags,
  };
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

const LOCAL_PASSAGE_EXCERPT_CHARS = 700;

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

const isLocalSourceUrl = (url: string): boolean => url.startsWith("local://");

const passageMatchesQuery = (passage: LocalKnowledgePassage, query: string): boolean => {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return false;
  const haystack = `${passage.title} ${passage.text}`.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits += 1;
  }
  return hits >= Math.min(2, tokens.length);
};

const composeAnswerFromWebSources = (query: string, sources: readonly SourceDescriptor[]): string => {
  const webSources = sources.filter((source) => !isLocalSourceUrl(source.homeUrl)).slice(0, 5);
  if (webSources.length === 0) {
    return sourceOnlyFallbackAnswer(query, sources);
  }
  return sourceOnlyFallbackAnswer(query, webSources);
};

const sourceMatchesQuery = (source: SourceDescriptor, query: string): boolean => {
  const passage: LocalKnowledgePassage = {
    title: source.name,
    text: `${source.description ?? ""} ${source.homeUrl}`,
    url: source.homeUrl,
  };
  return passageMatchesQuery(passage, query);
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

const extractSubstantiveExcerpt = (text: string, maxSentences = 3): string => {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  const sentences = cleaned.split(/(?<=[.!?])\s+/u).filter((sentence) => sentence.length >= 25);
  if (sentences.length === 0) {
    return cleaned.slice(0, LOCAL_PASSAGE_EXCERPT_CHARS);
  }
  return sentences.slice(0, maxSentences).join(" ");
};

const hasSubstantiveLocalPassages = (local: LocalKnowledgeContext, query: string): boolean =>
  local.passages.some((passage) => passage.text.trim().length >= 40 && passageMatchesQuery(passage, query));

const selectRelevantLocalKnowledge = (query: string, local: LocalKnowledgeContext): LocalKnowledgeContext => {
  if (!hasSubstantiveLocalPassages(local, query)) {
    return { digest: "", passages: [], sources: [] };
  }
  const passages = local.passages.filter((passage) => passageMatchesQuery(passage, query));
  const sources = local.sources.filter((source) =>
    passages.some((passage) => normalizeUrl(passage.url) === normalizeUrl(source.homeUrl)),
  );
  const digest = [
    "Local Knowledge Context (lower authority than approved web/repo sources)",
    ...passages.map((passage, index) => `${index + 1}. ${passage.title}: ${passage.text} (${passage.url})`),
  ].join("\n");
  return {
    digest,
    passages,
    sources: sources.length > 0 ? sources : local.sources.slice(0, passages.length),
  };
};

const composeComprehensiveAnswerFromLocal = (query: string, local: LocalKnowledgeContext): string => {
  const topic = query.trim().replace(/\?+$/u, "");
  const bullets = local.passages.slice(0, 4).map((passage, index) => {
    const excerpt = extractSubstantiveExcerpt(passage.text);
    const label = passage.title.trim() || "Archive excerpt";
    return `- ${label}: ${excerpt} [${index + 1}]`;
  });
  const lead = `Based on indexed KOTOR archive material, here is a concise answer about ${topic}:`;
  return `${lead}\n\n${bullets.join("\n")}\n\n${formatSourcesSection(local.sources)}`;
};

const localKnowledgeFallbackAnswer = (query: string, local: LocalKnowledgeContext): string => {
  const relevantPassages = local.passages.filter((passage) => passageMatchesQuery(passage, query));
  if (relevantPassages.length > 0) {
    const relevantSources = local.sources.filter((source) =>
      relevantPassages.some((passage) => normalizeUrl(passage.url) === normalizeUrl(source.homeUrl)),
    );
    return composeComprehensiveAnswerFromLocal(query, {
      digest: local.digest,
      passages: relevantPassages,
      sources: relevantSources.length > 0 ? relevantSources : local.sources.slice(0, relevantPassages.length),
    });
  }
  return `I could not complete live archive synthesis for "${query.trim()}".`;
};

const resolveWebSourcesForFailedSynthesis = (
  query: string,
  retrievedSources: readonly SourceDescriptor[],
): readonly SourceDescriptor[] => {
  const candidates = retrievedSources.filter((source) => !isLocalSourceUrl(source.homeUrl));
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
  phase: ResearchWizardProgressEvent["phase"],
  makeDetail: (elapsedMs: number) => string,
  onProgress: ((event: ResearchWizardProgressEvent) => void) | undefined,
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

export class ResearchWizardClient implements ResearchWizardQueryHandler {
  private readonly openAiClient: OpenAI | null;

  public constructor(
    private readonly config: ResearchWizardRuntimeConfig,
    private readonly aiConfig: SharedAiConfig,
    private readonly approvedSources: readonly SourceDescriptor[] = traskApprovedResearchSources,
    private readonly localSearchProvider?: SearchProvider,
  ) {
    this.openAiClient = aiConfig.openAiApiKey
      ? new OpenAI({
          apiKey: aiConfig.openAiApiKey,
          ...(aiConfig.openAiBaseUrl ? { baseURL: aiConfig.openAiBaseUrl } : {}),
          ...(aiConfig.openAiDefaultHeaders ? { defaultHeaders: aiConfig.openAiDefaultHeaders } : {}),
        })
      : null;
  }

  public async listModels(): Promise<readonly ResearchWizardModelOption[]> {
    try {
      const dynamicModels = await listHeadlessGptResearcherModels(this.config);
      const seen = new Set(DEFAULT_RESEARCH_WIZARD_MODELS.map((model) => model.id));
      return [
        ...DEFAULT_RESEARCH_WIZARD_MODELS,
        ...dynamicModels.filter((model) => {
          if (seen.has(model.id)) return false;
          seen.add(model.id);
          return true;
        }),
      ];
    } catch {
      return DEFAULT_RESEARCH_WIZARD_MODELS;
    }
  }

  private async searchLocalKnowledge(query: string): Promise<LocalKnowledgeContext> {
    if (!this.localSearchProvider) {
      return { digest: "", passages: [], sources: [] };
    }

    try {
      const hits = await this.localSearchProvider.search(query, 4);
      const localHits = hits.filter((hit) => !isTraskApprovedBaseUrl(hit.url));
      if (localHits.length === 0) {
        return { digest: "", passages: [], sources: [] };
      }
      const passages: LocalKnowledgePassage[] = localHits.map((hit) => ({
        title: hit.title,
        text: hit.snippet,
        url: hit.url,
      }));
      const digest = [
        "Local Knowledge Context (lower authority than approved web/repo sources)",
        ...localHits.map((hit, index) => `${index + 1}. ${hit.title}: ${hit.snippet} (${hit.url})`),
      ].join("\n");
      return {
        digest,
        passages,
        sources: localHits.map((hit) => searchHitToSource(hit)),
      };
    } catch {
      return { digest: "", passages: [], sources: [] };
    }
  }

  private async rewriteForDiscord(
    query: string,
    report: string,
    approvedSources: readonly SourceDescriptor[],
    preferredModel?: string,
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
    options?: ResearchWizardQueryOptions,
  ): Promise<{ report: string; payload: ResearchWizardResponsePayload }> {
    if (approvedSources.length === 0) {
      throw new Error("No approved research sources are enabled.");
    }

    const allowedDomains = researchDomainsForSources(approvedSources);
    const raw = await runHeadlessGptResearcher(this.config, {
      query: buildResearchTask(query),
      custom_prompt: customPrompt,
      query_domains: allowedDomains,
      allowed_url_prefixes: approvedSources.map((source) => source.homeUrl),
      ...(options?.model?.trim() ? { model: options.model.trim() } : {}),
      report_type: "research_report",
      report_source: "web",
    });

    const payload: ResearchWizardResponsePayload = {
      report: raw.report,
      ...(raw.research_information !== undefined
        ? { research_information: { ...raw.research_information } }
        : {}),
    };

    const report = typeof raw.report === "string" ? normalizeReport(raw.report) : "";

    if (!report) {
      throw new Error("ai-researchwizard returned an empty report.");
    }

    return { report, payload };
  }

  public async answerQuestion(
    query: string,
    onProgress?: (event: ResearchWizardProgressEvent) => void,
    options?: ResearchWizardQueryOptions,
  ): Promise<ResearchWizardAnswer> {
    const approvedSources = routeSourcesForQuery(
      query,
      applySourcePreferences(this.approvedSources, options?.sourcePreferences),
    );
    const localKnowledge = await this.searchLocalKnowledge(query);
    const relevantLocalKnowledge = selectRelevantLocalKnowledge(query, localKnowledge);
    if (localKnowledge.sources.length > 0) {
      onProgress?.({
        phase: "gather",
        detail: `Loaded ${localKnowledge.sources.length} local knowledge hit${localKnowledge.sources.length === 1 ? "" : "s"} from indexed archives.`,
        sources: localKnowledge.sources,
      });
    }
    try {
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
      const reportWithLocalContext = relevantLocalKnowledge.digest
        ? `${report}\n\n${relevantLocalKnowledge.digest}`
        : report;
      const retrievedSources = rerankEvidenceSources(
        query,
        mergeSourcesPreserveOrder(
          collectRetrievedSources(report, approvedSources, payload),
          relevantLocalKnowledge.sources,
        ),
      );
      const citedSourcesFromReport = rerankEvidenceSources(
        query,
        mergeSourcesPreserveOrder(
          collectCitedSources(report, approvedSources, payload),
          collectCitedSourcesFromText(reportWithLocalContext, relevantLocalKnowledge.sources),
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
      let answer: string;
      if (retrievedSources.length === 0) {
        answer = degradedAnswerFallback(query, approvedSources);
      } else if (isSynthesisFailureText(report)) {
        const webSources = resolveWebSourcesForFailedSynthesis(query, retrievedSources);
        if (relevantLocalKnowledge.passages.length > 0) {
          answer = composeComprehensiveAnswerFromLocal(query, relevantLocalKnowledge);
        } else if (webSources.length > 0) {
          answer = composeAnswerFromWebSources(query, webSources);
        } else if (localKnowledge.digest) {
          answer = localKnowledgeFallbackAnswer(query, localKnowledge);
        } else if (retrievedSources.length > 0) {
          answer = sourceOnlyFallbackAnswer(query, retrievedSources);
        } else {
          answer = degradedAnswerFallback(query, approvedSources);
        }
      } else if (this.openAiClient) {
        answer = await this.rewriteForDiscord(
          query,
          reportWithLocalContext,
          retrievedSources,
          options?.model,
        );
      } else {
        answer = fallbackDiscordRewrite(query, reportWithLocalContext, retrievedSources);
      }

      const citedSources = rerankEvidenceSources(
        query,
        mergeSourcesPreserveOrder(
          collectCitedSourcesFromText(answer, retrievedSources),
          citedSourcesFromReport,
        ),
      );

      return {
        answer,
        approvedSources: citedSources,
        retrievedSources,
        visitedUrls: collectVisitedUrlsFromPayload(payload, approvedSources),
      };
    } catch {
      onProgress?.({
        phase: "compose",
        detail: "Rendering fallback Holocron answer…",
      });
      if (localKnowledge.sources.length > 0) {
        const fallbackAnswer = localKnowledgeFallbackAnswer(query, localKnowledge);
        return {
          answer: fallbackAnswer,
          approvedSources: collectCitedSourcesFromText(fallbackAnswer, localKnowledge.sources),
          retrievedSources: localKnowledge.sources,
          visitedUrls: [],
        };
      }
      return {
        answer: degradedAnswerFallback(query, approvedSources),
        approvedSources: [],
        retrievedSources: [],
        visitedUrls: [],
      };
    }
  }

  /** Shorter rewrite for proactive/channel replies (still source-backed). */
  public async answerQuestionBrief(query: string): Promise<ResearchWizardBriefAnswer> {
    const localKnowledge = await this.searchLocalKnowledge(query);
    const relevantLocalKnowledge = selectRelevantLocalKnowledge(query, localKnowledge);
    try {
      const approvedSources = routeSourcesForQuery(query, this.approvedSources);
      const { report, payload } = await this.fetchResearchReport(query, buildCustomPromptBrief(), approvedSources);
      const reportWithLocalContext = relevantLocalKnowledge.digest ? `${report}\n\n${relevantLocalKnowledge.digest}` : report;
      const retrievedSources = rerankEvidenceSources(
        query,
        mergeSourcesPreserveOrder(
          collectRetrievedSources(report, approvedSources, payload),
          relevantLocalKnowledge.sources,
        ),
      );
      const answer = retrievedSources.length > 0
        ? await this.rewriteForDiscordBrief(query, reportWithLocalContext, retrievedSources)
        : degradedAnswerFallback(query, approvedSources);

      return {
        answer,
        approvedSources: rerankEvidenceSources(
          query,
          mergeSourcesPreserveOrder(
            collectCitedSourcesFromText(answer, retrievedSources),
            collectCitedSources(report, approvedSources, payload),
          ),
        ),
        retrievedSources,
        visitedUrls: collectVisitedUrlsFromPayload(payload, approvedSources),
        researchReport: reportWithLocalContext,
      };
    } catch {
      const answer = relevantLocalKnowledge.sources.length > 0
        ? composeComprehensiveAnswerFromLocal(query, relevantLocalKnowledge)
        : degradedAnswerFallback(query, this.approvedSources);
      return {
        answer,
        approvedSources: collectCitedSourcesFromText(answer, relevantLocalKnowledge.sources),
        retrievedSources: relevantLocalKnowledge.sources,
        visitedUrls: [],
        researchReport: answer,
      };
    }
  }
}

export const createResearchWizardClient = (
  config: ResearchWizardRuntimeConfig,
  aiConfig: SharedAiConfig = loadSharedAiConfig(),
  localSearchProvider?: SearchProvider,
): ResearchWizardClient => {
  return new ResearchWizardClient(config, aiConfig, traskApprovedResearchSources, localSearchProvider);
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
  isSynthesisFailureText as _isSynthesisFailureText,
  normalizeReport as _normalizeReport,
  formatSourcesSection as _formatSourcesSection,
  normalizePreferredRewriteModel as _normalizePreferredRewriteModel,
  matchApprovedSource as _matchApprovedSource,
  classifyQueryIntent as _classifyQueryIntent,
  routeSourcesForQuery as _routeSourcesForQuery,
};
