import type OpenAI from "openai";

import type { SourceDescriptor } from "@openkotor/retrieval";

import { splitResearchAnswer } from "./discord-reply-format.js";

const MIN_WEB_CITATIONS = 2;

export type EvidenceAuthority = "web" | "local" | "discord";
export type GroundingStatus = "grounded" | "partial" | "failed";

export interface EvidencePassage {
  text: string;
  url: string;
  host: string;
  authority: EvidenceAuthority;
}

export interface EvidenceClaim {
  claim: string;
  quote: string;
  url: string;
  sourceIndex: number;
  authority: EvidenceAuthority;
}

const HOST_AUTHORITY_SCORE: Readonly<Record<string, number>> = {
  "deadlystream.com": 5,
  "lucasforumsarchive.org": 5,
  "kotor.neocities.org": 4,
  "github.com": 4,
  "strategywiki.org": 3,
  "en.wikipedia.org": 2,
};

const CITATION_INDEX_RE = /\[(\d{1,3})\]/g;

const passageAuthority = (url: string): EvidenceAuthority => {
  if (url.startsWith("local://")) return "local";
  if (url.startsWith("discord://")) return "discord";
  return "web";
};

/** Structured hits from `POST /retrieve` or `trask_web_research.py` `passages` field. */
export interface RetrievePassageRow {
  readonly quote: string;
  readonly url: string;
  readonly host?: string;
}

export const passagesFromRetrieveRows = (rows: readonly RetrievePassageRow[]): EvidencePassage[] => {
  const passages: EvidencePassage[] = [];
  for (const row of rows) {
    const text = row.quote.trim();
    const url = row.url.trim();
    if (!text || !url) continue;
    const host = (row.host?.trim() || hostFromUrl(url) || "source").toLowerCase();
    passages.push({
      text,
      url,
      host,
      authority: passageAuthority(url),
    });
  }
  return passages;
};

const hostFromUrl = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
};

const authorityScore = (url: string): number => {
  const host = hostFromUrl(url);
  const base = Object.entries(HOST_AUTHORITY_SCORE).find(([baseHost]) =>
    host === baseHost || host.endsWith(`.${baseHost}`),
  );
  return base ? base[1] : 1;
};

const extractUrls = (value: string): string[] => {
  const matches = value.match(/[a-z][a-z0-9+.-]*:\/\/[^\s)>\]]+/giu) ?? [];
  return [...new Set(matches.map((match) => match.replace(/[.,;:!?]+$/, "")))];
};

export const splitReportIntoPassages = (report: string): EvidencePassage[] => {
  const normalized = report
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
  if (!normalized) return [];

  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const passages: EvidencePassage[] = [];

  for (const block of blocks) {
    const urls = extractUrls(block).filter((url) => !url.startsWith("discord://"));
    const url = urls[0] ?? "";
    const host = hostFromUrl(url);
    passages.push({
      text: block,
      url,
      host,
      authority: passageAuthority(url),
    });
  }

  return passages;
};

const sentenceChunks = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20);

export const extractClaimsHeuristic = (
  query: string,
  passages: readonly EvidencePassage[],
  maxClaims = 8,
): EvidenceClaim[] => {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 2);
  if (tokens.length === 0) return [];

  const claims: EvidenceClaim[] = [];
  const rankedPassages = [...passages].sort(
    (left, right) => authorityScore(right.url) - authorityScore(left.url),
  );

  for (const passage of rankedPassages) {
    if (passage.authority === "local") continue;
    if (passage.authority === "discord") {
      for (const sentence of sentenceChunks(passage.text)) {
        const lower = sentence.toLowerCase();
        const hits = tokens.filter((token) => lower.includes(token)).length;
        if (hits < Math.min(2, tokens.length)) continue;
        claims.push({
          claim: sentence.replace(/\[\d+\]/g, "").trim(),
          quote: sentence.length > 240 ? `${sentence.slice(0, 237)}…` : sentence,
          url: passage.url,
          sourceIndex: 0,
          authority: "discord",
        });
        if (claims.length >= maxClaims) return assignSourceIndices(claims);
      }
      continue;
    }
    if (!passage.url.startsWith("http")) continue;

    for (const sentence of sentenceChunks(passage.text)) {
      const lower = sentence.toLowerCase();
      const hits = tokens.filter((token) => lower.includes(token)).length;
      if (hits < Math.min(2, tokens.length)) continue;
      if (!sentence.includes('"') && sentence.length < 40) continue;

      claims.push({
        claim: sentence.replace(/\[\d+\]/g, "").trim(),
        quote: sentence,
        url: passage.url,
        sourceIndex: 0,
        authority: passage.authority,
      });
      if (claims.length >= maxClaims) break;
    }
    if (claims.length >= maxClaims) break;
  }

  return assignSourceIndices(claims);
};

const assignSourceIndices = (claims: EvidenceClaim[]): EvidenceClaim[] => {
  const urlToIndex = new Map<string, number>();
  let next = 1;
  return claims.map((claim) => {
    let index = urlToIndex.get(claim.url);
    if (!index) {
      index = next;
      urlToIndex.set(claim.url, index);
      next += 1;
    }
    return { ...claim, sourceIndex: index };
  });
};

export const extractClaimsWithLlm = async (
  client: OpenAI,
  model: string,
  query: string,
  passages: readonly EvidencePassage[],
): Promise<EvidenceClaim[]> => {
  const evidencePassages = passages
    .filter((p) => p.authority !== "local" && (p.url.startsWith("http") || p.url.startsWith("discord://")))
    .slice(0, 14);
  if (evidencePassages.length === 0) return [];

  const passageBlock = evidencePassages
    .map((p, i) => `[passage ${i + 1}] url=${p.url}\n${p.text.slice(0, 1200)}`)
    .join("\n\n");

  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Extract factual claims about the user question from passages. Each claim MUST include a verbatim quote copied from the passage. Return JSON: { \"claims\": [{ \"claim\", \"quote\", \"url\" }] }. Only use provided URLs. No claims without quotes.",
      },
      {
        role: "user",
        content: [
          "Passages:",
          passageBlock,
          "",
          "Extract claims for this question (question is last):",
          query.trim(),
        ].join("\n"),
      },
    ],
  });

  const raw = completion.choices[0]?.message?.content?.trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as { claims?: Array<{ claim?: string; quote?: string; url?: string }> };
    const claims = (parsed.claims ?? [])
      .filter((row) => row.claim && row.quote && row.url)
      .map((row) => {
        const url = row.url!.trim();
        return {
          claim: row.claim!.trim(),
          quote: row.quote!.trim(),
          url,
          sourceIndex: 0,
          authority: passageAuthority(url),
        };
      })
      .filter((row) =>
        evidencePassages.some((p) => p.text.includes(row.quote) || row.quote.includes(row.claim.slice(0, 40))),
      );
    return assignSourceIndices(claims);
  } catch {
    return [];
  }
};

export const composeGroundedAnswerFromClaims = (
  query: string,
  claims: readonly EvidenceClaim[],
  sources: readonly SourceDescriptor[],
): string => {
  const indexed = assignSourceIndices([...claims]);
  const byIndex = new Map<number, EvidenceClaim[]>();
  for (const claim of indexed) {
    const bucket = byIndex.get(claim.sourceIndex) ?? [];
    bucket.push(claim);
    byIndex.set(claim.sourceIndex, bucket);
  }

  const conflictHosts = new Set<string>();
  const hosts = indexed.map((c) => hostFromUrl(c.url)).filter(Boolean);
  if (new Set(hosts).size > 1 && hosts.length >= 2) {
    const uniqueQuotes = new Set(indexed.map((c) => c.quote.toLowerCase()));
    if (uniqueQuotes.size >= 2) {
      // Only flag conflict when quotes disagree on tooling terms — lightweight heuristic.
      const hasConflictCue = indexed.some((c) => /\bnot\b|\bhowever\b|\binstead\b/iu.test(c.quote));
      if (hasConflictCue) {
        for (const host of hosts) conflictHosts.add(host);
      }
    }
  }

  const bullets = indexed.map((claim) => `- ${claim.claim} [${claim.sourceIndex}]`);
  const caveat =
    conflictHosts.size > 0
      ? "\n\nCaveats: Sources disagree on details; compare the cited pages before installing."
      : "";

  const orderedSources: SourceDescriptor[] = [];
  const normalize = (url: string): string => url.trim().replace(/\/+$/u, "");
  for (const claim of indexed) {
    const match = sources.find(
      (source) => normalize(source.homeUrl) === normalize(claim.url),
    );
    if (match && !orderedSources.some((entry) => normalize(entry.homeUrl) === normalize(match.homeUrl))) {
      orderedSources.push(match);
    }
  }

  const body = [`Answer for: ${query.trim()}`, "", ...bullets, caveat].join("\n").trim();
  const sourcesSection = [
    "Sources",
    ...orderedSources.map((source, index) => `${index + 1}. ${source.name} - ${source.homeUrl}`),
  ].join("\n");

  return `${body}\n\n${sourcesSection}`;
};

export const composeGroundedAnswerWithLlm = async (
  client: OpenAI,
  model: string,
  query: string,
  claims: readonly EvidenceClaim[],
  sources: readonly SourceDescriptor[],
): Promise<string | null> => {
  const indexed = assignSourceIndices([...claims]);
  const allowed = sources
    .slice(0, 8)
    .map((source, index) => `${index + 1}. ${source.name} - ${source.homeUrl}`)
    .join("\n");

  const evidenceLines = indexed
    .map((c) => `[${c.sourceIndex}] ${c.claim}\nQuote: "${c.quote}"\nURL: ${c.url}`)
    .join("\n\n");

  const trimmedQuery = query.trim();
  const completion = await client.chat.completions.create({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content:
          "Write a concise KOTOR modding answer using ONLY the evidence claims below. Every factual bullet needs an inline [n] citation tied to Allowed sources. Do not invent steps, paths, or tools not supported by a quote. End with a Sources heading listing only cited https sources (omit discord:// URLs from Sources). If evidence conflicts, add a short Caveats section.",
      },
      {
        role: "user",
        content: [
          "Evidence claims (use only these):",
          evidenceLines,
          "",
          "Allowed sources (https citations only):",
          allowed,
          "",
          "Answer the following question now. The question line must be the last thing you read before writing:",
          trimmedQuery,
        ].join("\n"),
      },
    ],
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text || !/\nSources\s*\n/i.test(text)) return null;
  return text;
};

export const rankPassagesForQuery = (
  passages: readonly EvidencePassage[],
  query: string,
): EvidencePassage[] => {
  const tokens = query
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 2);
  if (tokens.length === 0) return [...passages];

  const scorePassage = (passage: EvidencePassage): number => {
    const haystack = passage.text.toLowerCase();
    let hits = 0;
    for (const token of tokens) {
      if (haystack.includes(token)) hits += 1;
    }
    return hits * 4 + authorityScore(passage.url);
  };

  return [...passages].sort((left, right) => scorePassage(right) - scorePassage(left));
};

/** One claim per distinct https passage (offline / no-LLM compose when sentence heuristics are thin). */
export const claimsFromDistinctPassages = (
  passages: readonly EvidencePassage[],
  maxClaims = 6,
): EvidenceClaim[] => {
  const claims: EvidenceClaim[] = [];
  const seenUrls = new Set<string>();
  for (const passage of passages) {
    if (!passage.url.startsWith("http")) continue;
    if (seenUrls.has(passage.url)) continue;
    const text = passage.text.replace(/\s+/g, " ").trim();
    if (text.length < 24) continue;
    const claimText = text.length > 280 ? `${text.slice(0, 277)}…` : text;
    claims.push({
      claim: claimText,
      quote: text.length > 500 ? `${text.slice(0, 497)}…` : text,
      url: passage.url,
      sourceIndex: 0,
      authority: passage.authority,
    });
    seenUrls.add(passage.url);
    if (claims.length >= maxClaims) break;
  }
  return assignSourceIndices(claims);
};

export const countDistinctWebClaimUrls = (claims: readonly EvidenceClaim[]): number =>
  new Set(claims.filter((c) => c.authority === "web" && c.url.startsWith("http")).map((c) => c.url)).size;

export const countDistinctDiscordClaims = (claims: readonly EvidenceClaim[]): number =>
  new Set(claims.filter((c) => c.authority === "discord").map((c) => c.url)).size;

/** Holocron needs ≥2 public https citations; Discord passages can supplement thin web recall. */
export const hasMinimumGroundedSupport = (claims: readonly EvidenceClaim[]): boolean => {
  const webUrls = countDistinctWebClaimUrls(claims);
  if (webUrls >= MIN_WEB_CITATIONS) return true;
  if (webUrls >= 1 && countDistinctDiscordClaims(claims) >= 1) return true;
  return false;
};

export const collectCitationIndicesFromAnswer = (answer: string): number[] => {
  const { body } = splitResearchAnswer(answer);
  const indices = new Set<number>();
  for (const match of body.matchAll(CITATION_INDEX_RE)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) indices.add(value);
  }
  return [...indices].sort((left, right) => left - right);
};

export const collectCitedSourcesFromAnswer = (
  answer: string,
  candidateSources: readonly SourceDescriptor[],
  materializeFromText: (text: string, pool: readonly SourceDescriptor[]) => readonly SourceDescriptor[],
): readonly SourceDescriptor[] => {
  const indices = collectCitationIndicesFromAnswer(answer);
  if (indices.length === 0) return [];

  const fromSection = materializeFromText(answer, candidateSources);
  const pool = fromSection.length > 0 ? fromSection : candidateSources;
  const aligned: SourceDescriptor[] = [];

  for (const index of indices) {
    const source = pool[index - 1];
    if (!source) continue;
    if (!source.homeUrl.startsWith("http")) continue;
    if (aligned.some((entry) => entry.homeUrl === source.homeUrl)) continue;
    aligned.push(source);
  }

  return aligned;
};

export const inferGroundingStatus = (
  answer: string,
  citedSourceCount: number,
): GroundingStatus => {
  if (/^i could not complete live (?:web )?research\b/iu.test(answer.trim())) {
    return "failed";
  }
  if (/could not support a grounded answer/i.test(answer)) {
    return "partial";
  }
  const indices = collectCitationIndicesFromAnswer(answer);
  if (indices.length >= MIN_WEB_CITATIONS && citedSourceCount >= MIN_WEB_CITATIONS) {
    return "grounded";
  }
  if (indices.length > 0 || citedSourceCount > 0) {
    return "partial";
  }
  return "failed";
};
