import OpenAI from "openai";

import { loadSharedAiConfig, type ResearchWizardRuntimeConfig, type SharedAiConfig } from "@openkotor/config";
import { traskApprovedResearchSourceUrls, traskApprovedResearchSources, type SourceDescriptor } from "@openkotor/retrieval";

export interface ResearchWizardAnswer {
  answer: string;
  approvedSources: readonly SourceDescriptor[];
}

interface ResearchWizardResponsePayload {
  report?: unknown;
  research_information?: {
    source_urls?: unknown;
    visited_urls?: unknown;
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

const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

const normalizeUrl = (value: string): string => value.replace(/\/+$/, "").trim();

const extractUrls = (value: string): string[] => {
  const matches = value.match(/https?:\/\/[^\s)>\]]+/g) ?? [];
  return [...new Set(matches.map((match) => match.replace(/[.,;:!?]+$/, "")))];
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

const sourceMentionedInReport = (report: string, source: SourceDescriptor): boolean => {
  const normalizedReport = report.toLowerCase();
  const normalizedSourceName = source.name.toLowerCase().trim();

  if (normalizedSourceName.length >= 4 && normalizedReport.includes(normalizedSourceName)) {
    return true;
  }

  try {
    const hostname = new URL(source.homeUrl).hostname.replace(/^www\./, "").toLowerCase();
    return hostname.length > 0 && normalizedReport.includes(hostname);
  } catch {
    return false;
  }
};

const collectRelevantSources = (
  report: string,
  approvedSources: readonly SourceDescriptor[],
  payload: ResearchWizardResponsePayload,
): readonly SourceDescriptor[] => {
  const candidateUrls = [
    ...extractUrls(report),
    ...((Array.isArray(payload.research_information?.source_urls) ? payload.research_information.source_urls : [])
      .filter((value): value is string => typeof value === "string")),
    ...((Array.isArray(payload.research_information?.visited_urls) ? payload.research_information.visited_urls : [])
      .filter((value): value is string => typeof value === "string")),
  ];

  const matched: SourceDescriptor[] = [];

  for (const url of candidateUrls) {
    const source = matchApprovedSource(url, approvedSources);

    if (source && !matched.some((entry) => entry.id === source.id)) {
      matched.push(source);
    }
  }

  for (const source of approvedSources) {
    if (sourceMentionedInReport(report, source) && !matched.some((entry) => entry.id === source.id)) {
      matched.push(source);
    }
  }

  return matched;
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

const fallbackDiscordRewrite = (
  report: string,
  sources: readonly SourceDescriptor[],
): string => {
  const sourceIndexByUrl = new Map<string, number>(
    sources.map((source, index) => [normalizeUrl(source.homeUrl), index + 1]),
  );

  const [bodyOnlyCandidate = ""] = normalizeReport(report).split(/\n(?:#{1,6}\s*)?(?:Sources|References)\s*\n/i, 1);
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

  return `${summary}\n\n${formatSourcesSection(sources)}`;
};

const buildHeaders = (apiKey: string | undefined): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["X-API-Key"] = apiKey;
  }

  return headers;
};

export class ResearchWizardClient {
  private readonly openAiClient: OpenAI | null;

  public constructor(
    private readonly config: ResearchWizardRuntimeConfig,
    private readonly aiConfig: SharedAiConfig,
    private readonly approvedSources: readonly SourceDescriptor[] = traskApprovedResearchSources,
  ) {
    this.openAiClient = aiConfig.openAiApiKey
      ? new OpenAI({ apiKey: aiConfig.openAiApiKey })
      : null;
  }

  private async rewriteForDiscord(
    query: string,
    report: string,
    approvedSources: readonly SourceDescriptor[],
  ): Promise<string> {
    if (!this.openAiClient) {
      return fallbackDiscordRewrite(report, approvedSources);
    }

    const allowedSources = approvedSources
      .map((source, index) => `${index + 1}. ${source.name} - ${source.homeUrl}`)
      .join("\n");

    try {
      const completion = await this.openAiClient.chat.completions.create({
        model: this.aiConfig.chatModel,
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
      });

      const rewritten = completion.choices[0]?.message?.content?.trim();

      if (rewritten && /\nSources\s*\n/i.test(rewritten)) {
        return rewritten;
      }
    } catch {
      // Fall through to deterministic formatting.
    }

    return fallbackDiscordRewrite(report, approvedSources);
  }

  public async answerQuestion(query: string): Promise<ResearchWizardAnswer> {
    const baseUrl = this.config.baseUrl?.trim();

    if (!baseUrl) {
      throw new Error("TRASK_RESEARCHWIZARD_BASE_URL is not configured.");
    }

    const response = await fetch(`${normalizeBaseUrl(baseUrl)}/report/`, {
      method: "POST",
      headers: buildHeaders(this.config.apiKey),
      signal: AbortSignal.timeout(this.config.timeoutMs),
      body: JSON.stringify({
        task: buildResearchTask(query),
        report_type: "research_report",
        report_source: "web",
        tone: "Objective",
        custom_prompt: buildCustomPrompt(),
        source_urls: this.approvedSources.map((source) => source.homeUrl),
        query_domains: this.approvedSources.map((source) => new URL(source.homeUrl).hostname),
        generate_in_background: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`ResearchWizard request failed with status ${response.status}.`);
    }

    const payload = (await response.json()) as ResearchWizardResponsePayload;
    const report = typeof payload.report === "string" ? normalizeReport(payload.report) : "";

    if (!report) {
      throw new Error("ResearchWizard returned an empty report.");
    }

    const relevantSources = collectRelevantSources(report, this.approvedSources, payload);
    const answer = await this.rewriteForDiscord(query, report, relevantSources);

    return {
      answer,
      approvedSources: relevantSources,
    };
  }
}

export const createResearchWizardClient = (
  config: ResearchWizardRuntimeConfig,
  aiConfig: SharedAiConfig = loadSharedAiConfig(),
): ResearchWizardClient => {
  return new ResearchWizardClient(config, aiConfig);
};