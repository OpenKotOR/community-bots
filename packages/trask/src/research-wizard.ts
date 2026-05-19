import OpenAI from "openai";

import { loadSharedAiConfig, type ResearchWizardRuntimeConfig, type SharedAiConfig } from "@openkotor/config";
import {
  isTraskApprovedBaseUrl,
  isTraskApprovedResearchUrl,
  sourceUrlMatchesDescriptor,
  traskApprovedResearchBaseHosts,
  traskApprovedResearchSources,
  type SearchProvider,
  type SourceDescriptor,
} from "@openkotor/retrieval";

import {
  collectCitedSourcesFromAnswer,
  collectCitationIndicesFromAnswer,
  composeGroundedAnswerFromClaims,
  composeGroundedAnswerWithLlm,
  claimsFromDistinctPassages,
  rankPassagesForQuery,
  extractClaimsHeuristic,
  extractClaimsWithLlm,
  hasMinimumGroundedSupport,
  inferGroundingStatus,
  passagesFromRetrieveRows,
  splitReportIntoPassages,
  type GroundingStatus,
  type RetrievePassageRow,
} from "./grounded-evidence.js";

import {
  isGroundedComposeEnabled,
  isIndexMissPayload,
  isRewriteComposeEnabled,
} from "./research-compose.js";
import { runTraskWebResearch } from "./trask-research-subprocess.js";

export interface ResearchWizardAnswer {
  answer: string;
  /** Sources explicitly cited in the final answer shown to users. */
  approvedSources: readonly SourceDescriptor[];
  /** Sources retrieved as candidate evidence for the answer/rewrite stage. */
  retrievedSources: readonly SourceDescriptor[];
  /** Allowlisted URLs the headless researcher touched while gathering evidence. */
  visitedUrls: readonly string[];
  /** Grounding quality signal for Holocron provenance UI. */
  groundingStatus?: GroundingStatus;
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
  /** Preferred rewrite model id, e.g. `openrouter:openrouter/auto` or `litellm:moonshotai/kimi-k2`. */
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

export interface ResearchWizardModelOption {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly recommended?: boolean;
}

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
  passages?: readonly RetrievePassageRow[] | null;
  research_information?: {
    source_urls?: readonly string[] | null;
    cited_urls?: readonly string[] | null;
    retrieved_urls?: readonly string[] | null;
    visited_urls?: readonly string[] | null;
    query_domains?: readonly string[] | null;
    allowed_url_prefixes?: readonly string[] | null;
    rejected_source_urls?: readonly string[] | null;
    index_miss?: boolean | null;
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

const isAllowedSourceUrl = (url: string, sourcePool: readonly SourceDescriptor[]): boolean => {
  if (!isPublicWebCitationUrl(url)) return false;
  if (sourcePool.some((source) => sourceUrlMatchesDescriptor(url, source))) return true;
  if (isTraskApprovedResearchUrl(url, sourcePool)) return true;
  return isTraskApprovedBaseUrl(url);
};

/** Visited URLs from web research payload (Holocron live facet pings). */
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

/** Bare host roots (e.g. `https://deadlystream.com`) — not deep catalog pages like `https://github.com/reone/reone`. */
const isShallowCatalogRootUrl = (url: string, approvedSources: readonly SourceDescriptor[]): boolean => {
  if (!isCatalogRootUrl(url, approvedSources)) return false;
  try {
    const path = new URL(url).pathname.replace(/\/+$/u, "");
    return path === "";
  } catch {
    return false;
  }
};

const materializeSourcesFromUrls = (
  urls: readonly string[],
  sourcePool: readonly SourceDescriptor[],
): readonly SourceDescriptor[] => {
  const candidateUrls = uniqueUrlsPreserveOrder(
    urls.filter((url) => isAllowedSourceUrl(url, sourcePool)),
  );

  const matched: SourceDescriptor[] = [];
  const hasPreciseUrl = candidateUrls.some((url) => !isShallowCatalogRootUrl(url, sourcePool));

  for (const url of candidateUrls) {
    if (hasPreciseUrl && isShallowCatalogRootUrl(url, sourcePool)) continue;
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

const countPayloadWebUrls = (payload: ResearchWizardResponsePayload): number => {
  const info = payload.research_information;
  const urls = uniqueUrlsPreserveOrder([
    ...payloadUrls(info?.cited_urls),
    ...payloadUrls(info?.retrieved_urls),
    ...payloadUrls(info?.visited_urls),
    ...payloadUrls(info?.source_urls),
  ]);
  return urls.filter((url) => isPublicWebCitationUrl(url)).length;
};

const isSynthesisFailureReport = (report: string, payload: ResearchWizardResponsePayload): boolean => {
  const normalized = report.trim();
  const webUrlCount = countPayloadWebUrls(payload);
  if (webUrlCount >= MIN_HOLOCRON_WEB_CITATIONS) {
    return /^i could not complete live archive synthesis\b/iu.test(normalized);
  }
  if (/^i could not complete live archive synthesis\b/iu.test(normalized)) {
    return true;
  }
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
  if (/^i could not complete live archive synthesis\b/iu.test(normalized)) {
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
  if (url.startsWith("local://") || url.startsWith("discord://")) return false;
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
  payload: ResearchWizardResponsePayload,
): readonly SourceDescriptor[] => {
  const pool = mergeSourcesPreserveOrder(
    collectRetrievedSources(report, approvedSources, payload),
    collectCitedSources(report, approvedSources, payload),
    materializeSourcesFromUrls(collectVisitedUrlsFromPayload(payload, approvedSources), approvedSources),
  );
  return rerankEvidenceSources(query, filterPublicWebCitationSources(pool));
};

const resolveEvidencePassages = (
  report: string,
  payload: ResearchWizardResponsePayload,
): ReturnType<typeof splitReportIntoPassages> => {
  const structured = payload.passages?.filter(
    (row): row is RetrievePassageRow =>
      Boolean(row?.quote?.trim() && row?.url?.trim()),
  );
  if (structured && structured.length > 0) {
    return passagesFromRetrieveRows(structured);
  }
  return splitReportIntoPassages(report);
};

const alignCitedSourcesToAnswer = (
  answer: string,
  candidateSources: readonly SourceDescriptor[],
): readonly SourceDescriptor[] =>
  collectCitedSourcesFromAnswer(answer, candidateSources, collectCitedSourcesFromText);

const hostnamesFromUrls = (urls: readonly string[]): string[] => {
  const hosts = new Set<string>();
  for (const url of urls) {
    try {
      hosts.add(new URL(url).hostname.replace(/^www\./, ""));
    } catch {
      continue;
    }
  }
  return [...hosts];
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
    return DEFAULT_RESEARCH_WIZARD_MODELS;
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

  private async searchLocalKnowledge(query: string): Promise<string> {
    if (!this.localSearchProvider) return "";
    try {
      const hits = await this.localSearchProvider.search(query, 4);
      const approved = hits.filter((hit) => isTraskApprovedBaseUrl(hit.url));
      if (approved.length === 0) return "";
      const lines = approved.map(
        (hit) => `- ${hit.title}: ${hit.snippet} (${hit.url})`,
      );
      return [
        "Local Knowledge Context (lower authority than live web research; never cite as https Sources):",
        ...lines,
      ].join("\n");
    } catch {
      return "";
    }
  }

  private async tryGroundedCompose(
    query: string,
    report: string,
    payload: ResearchWizardResponsePayload,
    retrievedSources: readonly SourceDescriptor[],
    preferredModel?: string,
  ): Promise<{ answer: string; approvedSources: readonly SourceDescriptor[] } | null> {
    if (!isGroundedComposeEnabled(this.config)) {
      return null;
    }

    if (isIndexMissPayload(payload)) {
      return null;
    }

    const passages = rankPassagesForQuery(resolveEvidencePassages(report, payload), query);
    if (passages.length === 0) {
      return null;
    }

    const model = normalizePreferredRewriteModel(preferredModel) ?? this.aiConfig.chatModel;

    let claims = claimsFromDistinctPassages(passages);
    if (!hasMinimumGroundedSupport(claims) && this.openAiClient) {
      const llmClaims = await extractClaimsWithLlm(this.openAiClient, model, query, passages);
      if (hasMinimumGroundedSupport(llmClaims)) {
        claims = llmClaims;
      }
    }
    if (!hasMinimumGroundedSupport(claims)) {
      const heuristicClaims = extractClaimsHeuristic(query, passages);
      if (hasMinimumGroundedSupport(heuristicClaims)) {
        claims = heuristicClaims;
      }
    }

    if (!hasMinimumGroundedSupport(claims)) {
      return null;
    }

    const webSources = filterPublicWebCitationSources(
      materializeSourcesFromUrls(claims.map((claim) => claim.url), this.approvedSources),
    );

    let answer = composeGroundedAnswerFromClaims(query, claims, webSources);
    if (this.openAiClient) {
      answer =
        (await composeGroundedAnswerWithLlm(this.openAiClient, model, query, claims, webSources))
        ?? answer;
    }

    let approvedSources = alignCitedSourcesToAnswer(answer, webSources);
    if (approvedSources.length < MIN_HOLOCRON_WEB_CITATIONS) {
      answer = sourceOnlyFallbackAnswer(query, webSources.slice(0, 5));
      approvedSources = alignCitedSourcesToAnswer(answer, webSources);
    }

    return { answer, approvedSources };
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
    const raw = await runTraskWebResearch(this.config, {
      query: buildResearchTask(query),
      query_domains: allowedDomains,
      allowed_url_prefixes: approvedSources.map((source) => source.homeUrl),
    });

    const payload: ResearchWizardResponsePayload = {
      report: raw.report,
      ...(raw.passages?.length ? { passages: [...raw.passages] } : {}),
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
    onProgress?: (event: ResearchWizardProgressEvent) => void,
    options?: ResearchWizardQueryOptions,
  ): Promise<ResearchWizardAnswer> {
    const approvedSources = routeSourcesForQuery(
      query,
      applySourcePreferences(this.approvedSources, options?.sourcePreferences),
    );
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
      const enrichedReport = report;
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
      const webEvidenceSources = collectWebEvidenceSources(query, enrichedReport, approvedSources, payload);
      const retrievedSources = webEvidenceSources;
      const visitedUrls = collectVisitedUrlsFromPayload(payload, approvedSources);
      const visitedHosts = hostnamesFromUrls(visitedUrls);
      const citedSourcesFromReport = rerankEvidenceSources(
        query,
        mergeSourcesPreserveOrder(
          collectCitedSources(enrichedReport, approvedSources, payload),
          collectCitedSourcesFromText(enrichedReport, approvedSources),
        ),
      );
      onProgress?.({
        phase: "sources",
        detail: retrievedSources.length
          ? `${retrievedSources.length} sources retrieved${visitedHosts.length ? ` · ${visitedHosts.slice(0, 4).join(", ")}` : ""}`
          : "Mapping hosts to archive catalog…",
        sources: retrievedSources,
      });
      onProgress?.({
        phase: "compose",
        detail: "Rendering Holocron answer…",
      });
      let answer: string;
      const grounded =
        !isIndexMissPayload(payload) && !isSynthesisFailureReport(enrichedReport, payload)
          ? await this.tryGroundedCompose(query, enrichedReport, payload, retrievedSources, options?.model)
          : null;

      if (grounded) {
        answer = grounded.answer;
      } else if (isIndexMissPayload(payload)) {
        const webSources = filterPublicWebCitationSources(retrievedSources);
        answer =
          webSources.length > 0
            ? sourceOnlyFallbackAnswer(query, webSources)
            : degradedAnswerFallback(query, approvedSources);
      } else if (retrievedSources.length === 0) {
        answer = degradedAnswerFallback(query, approvedSources);
      } else if (isSynthesisFailureReport(enrichedReport, payload)) {
        const webSources = resolveWebSourcesForFailedSynthesis(query, retrievedSources);
        if (webSources.length >= MIN_HOLOCRON_WEB_CITATIONS && isRewriteComposeEnabled(this.config)) {
          const sourcesForRewrite = filterPublicWebCitationSources(webSources);
          answer = this.openAiClient
            ? await this.rewriteForDiscord(query, enrichedReport, sourcesForRewrite, options?.model)
            : fallbackDiscordRewrite(query, enrichedReport, sourcesForRewrite);
        } else if (webSources.length > 0) {
          answer = sourceOnlyFallbackAnswer(query, webSources);
        } else {
          answer = degradedAnswerFallback(query, approvedSources);
        }
      } else if (
        isRewriteComposeEnabled(this.config)
        && this.openAiClient
        && (payload.passages?.length ?? 0) === 0
      ) {
        answer = await this.rewriteForDiscord(
          query,
          enrichedReport,
          filterPublicWebCitationSources(retrievedSources),
          options?.model,
        );
      } else if (this.openAiClient) {
        answer = sourceOnlyFallbackAnswer(
          query,
          filterPublicWebCitationSources(retrievedSources),
        );
      } else if (isRewriteComposeEnabled(this.config)) {
        answer = fallbackDiscordRewrite(
          query,
          enrichedReport,
          filterPublicWebCitationSources(retrievedSources),
        );
      } else {
        answer = sourceOnlyFallbackAnswer(
          query,
          filterPublicWebCitationSources(retrievedSources),
        );
      }

      const candidatePool = filterPublicWebCitationSources(
        mergeSourcesPreserveOrder(
          collectCitedSourcesFromText(answer, retrievedSources),
          citedSourcesFromReport,
          retrievedSources,
        ),
      );

      let citedSources = grounded
        ? grounded.approvedSources
        : alignCitedSourcesToAnswer(answer, candidatePool);

      if (
        citedSources.length < MIN_HOLOCRON_WEB_CITATIONS
        && collectCitationIndicesFromAnswer(answer).length < MIN_HOLOCRON_WEB_CITATIONS
        && !grounded
      ) {
        const fallbackSources = filterPublicWebCitationSources(
          resolveWebSourcesForFailedSynthesis(query, retrievedSources),
        );
        if (fallbackSources.length > 0) {
          answer = sourceOnlyFallbackAnswer(query, fallbackSources);
          citedSources = alignCitedSourcesToAnswer(answer, fallbackSources);
        }
      }

      const groundingStatus = inferGroundingStatus(answer, citedSources.length);

      return {
        answer,
        approvedSources: citedSources,
        retrievedSources,
        visitedUrls,
        groundingStatus,
      };
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      onProgress?.({
        phase: "compose",
        detail: `Live web research failed: ${detail.slice(0, 240)}`,
      });
      const topic = query.trim().replace(/\?+$/u, "") || "this question";
      return {
        answer: `I could not complete live web research for "${topic}" right now (${detail}). Ensure the Trask indexer or research venv is running (TRASK_INDEXER_BASE_URL, TRASK_WEB_RESEARCH_PYTHON, bootstrap via scripts/bootstrap_trask_research.sh), then retry.`,
        approvedSources: [],
        retrievedSources: [],
        visitedUrls: [],
      };
    }
  }

  /** Shorter rewrite for proactive/channel replies (still source-backed). */
  public async answerQuestionBrief(
    query: string,
    options?: ResearchWizardQueryOptions,
  ): Promise<ResearchWizardBriefAnswer> {
    try {
      const approvedSources = routeSourcesForQuery(
        query,
        applySourcePreferences(this.approvedSources, options?.sourcePreferences),
      );
      const { report, payload } = await this.fetchResearchReport(
        query,
        buildCustomPromptBrief(),
        approvedSources,
        options,
      );
      const enrichedReport = report;
      const webEvidenceSources = collectWebEvidenceSources(query, enrichedReport, approvedSources, payload);
      const retrievedSources = webEvidenceSources;
      const grounded =
        !isIndexMissPayload(payload) && !isSynthesisFailureReport(enrichedReport, payload)
          ? await this.tryGroundedCompose(query, enrichedReport, payload, retrievedSources, options?.model)
          : null;

      let answer: string;
      if (grounded) {
        answer = grounded.answer;
      } else if (isIndexMissPayload(payload)) {
        const webSources = filterPublicWebCitationSources(retrievedSources);
        answer =
          webSources.length > 0
            ? sourceOnlyFallbackAnswer(query, webSources)
            : degradedAnswerFallback(query, approvedSources);
      } else if (
        isRewriteComposeEnabled(this.config)
        && retrievedSources.length > 0
        && (payload.passages?.length ?? 0) === 0
      ) {
        answer = await this.rewriteForDiscordBrief(query, enrichedReport, retrievedSources);
      } else if (retrievedSources.length > 0) {
        answer = sourceOnlyFallbackAnswer(query, filterPublicWebCitationSources(retrievedSources));
      } else {
        answer = degradedAnswerFallback(query, approvedSources);
      }

      const candidatePool = filterPublicWebCitationSources(
        mergeSourcesPreserveOrder(
          collectCitedSourcesFromText(answer, retrievedSources),
          collectCitedSources(enrichedReport, approvedSources, payload),
          retrievedSources,
        ),
      );

      const citedSources = grounded
        ? grounded.approvedSources
        : alignCitedSourcesToAnswer(answer, candidatePool);

      return {
        answer,
        approvedSources: citedSources,
        retrievedSources,
        visitedUrls: collectVisitedUrlsFromPayload(payload, approvedSources),
        researchReport: enrichedReport,
        groundingStatus: inferGroundingStatus(answer, citedSources.length),
      };
    } catch {
      const topic = query.trim().replace(/\?+$/u, "") || "this question";
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
  isSynthesisFailureReport as _isSynthesisFailureReport,
  countPayloadWebUrls as _countPayloadWebUrls,
  normalizeReport as _normalizeReport,
  formatSourcesSection as _formatSourcesSection,
  normalizePreferredRewriteModel as _normalizePreferredRewriteModel,
  matchApprovedSource as _matchApprovedSource,
  classifyQueryIntent as _classifyQueryIntent,
  routeSourcesForQuery as _routeSourcesForQuery,
  alignCitedSourcesToAnswer as _alignCitedSourcesToAnswer,
  isGroundedComposeEnabled as _isGroundedComposeEnabled,
};
