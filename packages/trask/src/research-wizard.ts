import OpenAI from "openai";

import { loadSharedAiConfig, type ResearchWizardRuntimeConfig, type SharedAiConfig } from "@openkotor/config";
import {
  isTraskApprovedBaseUrl,
  isTraskApprovedResearchUrl,
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
  approvedSources: readonly SourceDescriptor[];
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
  const matches = value.match(/https?:\/\/[^\s)>\]]+/g) ?? [];
  return [...new Set(matches.map((match) => match.replace(/[.,;:!?]+$/, "")))];
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

/** Visited / cited URLs from ai-researchwizard payload (Holocron live facet pings). */
const collectVisitedUrlsFromPayload = (
  payload: ResearchWizardResponsePayload,
  approvedSources: readonly SourceDescriptor[],
): string[] => {
  const info = payload.research_information;
  const rawVisited =
    (Array.isArray(info?.visited_urls) ? info.visited_urls : []).filter(
      (value): value is string => typeof value === "string",
    );
  const rawSources =
    (Array.isArray(info?.source_urls) ? info.source_urls : []).filter((value): value is string => typeof value === "string");
  return uniqueUrlsPreserveOrder([...rawVisited, ...rawSources]).filter((url) =>
    isTraskApprovedResearchUrl(url, approvedSources),
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

const collectRelevantSources = (
  report: string,
  approvedSources: readonly SourceDescriptor[],
  payload: ResearchWizardResponsePayload,
): readonly SourceDescriptor[] => {
  const candidateUrls = uniqueUrlsPreserveOrder([
    ...extractUrls(report),
    ...((Array.isArray(payload.research_information?.source_urls) ? payload.research_information.source_urls : [])
      .filter((value): value is string => typeof value === "string")),
    ...((Array.isArray(payload.research_information?.visited_urls) ? payload.research_information.visited_urls : [])
      .filter((value): value is string => typeof value === "string")),
  ].filter((url) => isTraskApprovedResearchUrl(url, approvedSources)));

  const matched: SourceDescriptor[] = [];
  const hasPreciseUrl = candidateUrls.some((url) => !isCatalogRootUrl(url, approvedSources));

  for (const url of candidateUrls) {
    if (hasPreciseUrl && isCatalogRootUrl(url, approvedSources)) continue;
    const source = exactSourceFromUrl(url, approvedSources);

    if (source && !matched.some((entry) => normalizeUrl(entry.homeUrl) === normalizeUrl(source.homeUrl))) {
      matched.push(source);
    }
  }

  return matched.slice(0, 6);
};

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

const isSynthesisFailureText = (report: string): boolean =>
  /^i could not complete live archive synthesis for this question right now\.?$/iu.test(report.trim());

const titleCase = (value: string): string =>
  value
    .split(/\s+/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");

const sourceToolHint = (source: SourceDescriptor): string => {
  try {
    const parsed = new URL(source.homeUrl);
    const parts = parsed.pathname
      .split("/")
      .map((part) => decodeURIComponent(part).trim())
      .filter(Boolean);
    const candidate = parts[parts.length - 1] ?? "";
    const cleaned = candidate
      .replace(/^\d+-?/u, "")
      .replace(/^file-/u, "")
      .replace(/[-_]+/gu, " ")
      .trim();
    if (!cleaned || cleaned.length < 3) return source.name;
    return titleCase(cleaned);
  } catch {
    return source.name;
  }
};

const sourceOnlyFallbackAnswer = (sources: readonly SourceDescriptor[]): string => {
  if (sources.length === 0) return "I could not complete live archive synthesis for this question right now.";

  const hints = [...new Set(sources.map(sourceToolHint).filter((hint) => hint.length > 0))].slice(0, 5);
  const bullets = hints.map((hint, index) => `- ${hint} [${Math.min(index + 1, sources.length)}]`);
  const summary = [
    "Here are the most relevant pages I found in the approved KOTOR knowledge sources:",
    ...bullets,
  ].join("\n");

  return `${summary}\n\n${formatSourcesSection(sources)}`;
};

const DEFAULT_REWRITE_TIMEOUT_MS = 3_000;
const MAX_REWRITE_ATTEMPTS = 1;

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
  report: string,
  sources: readonly SourceDescriptor[],
): string => {
  const normalized = normalizeReport(report);
  if (isSynthesisFailureText(normalized)) {
    return sourceOnlyFallbackAnswer(sources);
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

const fallbackDiscordBrief = (report: string, sources: readonly SourceDescriptor[]): string => {
  const normalized = normalizeReport(report);
  if (isSynthesisFailureText(normalized)) {
    return sourceOnlyFallbackAnswer(sources);
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

interface LocalKnowledgeContext {
  digest: string;
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

const localKnowledgeFallbackAnswer = (query: string, local: LocalKnowledgeContext): string => {
  const header = `I could not complete live archive synthesis for "${query.trim()}", but I found related local knowledge.`;
  const summary = local.digest.trim();
  const sources = formatSourcesSection(local.sources);
  return `${header}\n\n${summary}\n\n${sources}`;
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
      return { digest: "", sources: [] };
    }

    try {
      const hits = await this.localSearchProvider.search(query, 4);
      const localHits = hits.filter((hit) => !isTraskApprovedBaseUrl(hit.url));
      if (localHits.length === 0) {
        return { digest: "", sources: [] };
      }
      const digest = [
        "Local Knowledge Context (lower authority than approved web/repo sources)",
        ...localHits.map((hit, index) => `${index + 1}. ${hit.title}: ${hit.snippet} (${hit.url})`),
      ].join("\n");
      return {
        digest,
        sources: localHits.map((hit) => searchHitToSource(hit)),
      };
    } catch {
      return { digest: "", sources: [] };
    }
  }

  private async rewriteForDiscord(
    query: string,
    report: string,
    approvedSources: readonly SourceDescriptor[],
    preferredModel?: string,
  ): Promise<string> {
    if (!this.openAiClient) {
      return fallbackDiscordRewrite(report, approvedSources);
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

    return fallbackDiscordRewrite(report, approvedSources);
  }

  private async rewriteForDiscordBrief(
    query: string,
    report: string,
    approvedSources: readonly SourceDescriptor[],
  ): Promise<string> {
    if (!this.openAiClient) {
      return fallbackDiscordBrief(report, approvedSources);
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

    return fallbackDiscordBrief(report, approvedSources);
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
    const approvedSources = applySourcePreferences(this.approvedSources, options?.sourcePreferences);
    const localKnowledge = await this.searchLocalKnowledge(query);
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
      const reportWithLocalContext = localKnowledge.digest
        ? `${report}\n\n${localKnowledge.digest}`
        : report;
      const relevantSources = mergeSourcesPreserveOrder(
        collectRelevantSources(reportWithLocalContext, approvedSources, payload),
        localKnowledge.sources,
      );
      onProgress?.({
        phase: "sources",
        detail: relevantSources.length ? `${relevantSources.length} sources matched` : "Mapping hosts to archive catalog…",
        sources: relevantSources,
      });
      onProgress?.({
        phase: "compose",
        detail: "Rendering Holocron answer…",
      });
      const answer = fallbackDiscordRewrite(reportWithLocalContext, relevantSources);

      return {
        answer,
        approvedSources: relevantSources,
      };
    } catch {
      onProgress?.({
        phase: "compose",
        detail: "Rendering fallback Holocron answer…",
      });
      if (localKnowledge.sources.length > 0) {
        return {
          answer: localKnowledgeFallbackAnswer(query, localKnowledge),
          approvedSources: localKnowledge.sources,
        };
      }
      return {
        answer: degradedAnswerFallback(query, approvedSources),
        approvedSources: [],
      };
    }
  }

  /** Shorter rewrite for proactive/channel replies (still source-backed). */
  public async answerQuestionBrief(query: string): Promise<ResearchWizardBriefAnswer> {
    const localKnowledge = await this.searchLocalKnowledge(query);
    const { report, payload } = await this.fetchResearchReport(query, buildCustomPromptBrief(), this.approvedSources);
    const reportWithLocalContext = localKnowledge.digest ? `${report}\n\n${localKnowledge.digest}` : report;
    const relevantSources = mergeSourcesPreserveOrder(
      collectRelevantSources(reportWithLocalContext, this.approvedSources, payload),
      localKnowledge.sources,
    );
    const answer = await this.rewriteForDiscordBrief(query, reportWithLocalContext, relevantSources);

    return {
      answer,
      approvedSources: relevantSources,
      researchReport: reportWithLocalContext,
    };
  }
}

export const createResearchWizardClient = (
  config: ResearchWizardRuntimeConfig,
  aiConfig: SharedAiConfig = loadSharedAiConfig(),
  localSearchProvider?: SearchProvider,
): ResearchWizardClient => {
  return new ResearchWizardClient(config, aiConfig, traskApprovedResearchSources, localSearchProvider);
};
