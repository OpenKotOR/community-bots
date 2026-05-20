import type OpenAI from "openai";

import type { SourceDescriptor } from "@openkotor/retrieval";
import {
  classifyQueryIntent,
  genericQueryTokenSet,
  loadLinguistics,
  loadPromptTemplate,
  loadTraskPolicy,
} from "@openkotor/trask-config";

import { splitResearchAnswer } from "./discord-reply-format.js";
import {
  isDiscordJumpUrl,
  resolvePublicCitationUrl,
  type DiscordPassageLocator,
} from "./discord-citation-url.js";

const MIN_WEB_CITATIONS = loadTraskPolicy().minWebCitations;
export const BRIEF_DISCORD_MIN_CITATIONS = 2;
export const BRIEF_MAX_CLAIM_LINES = 2;
/** Full Holocron answers: up to five bullets, at least `MIN_WEB_CITATIONS` distinct https URLs when available. */
export const HOLOCRON_FULL_MAX_CLAIM_LINES = 5;

export type EvidenceAuthority = "web" | "local" | "discord";
export type GroundingStatus = "grounded" | "partial" | "failed";

export interface EvidencePassage {
  text: string;
  url: string;
  host: string;
  authority: EvidenceAuthority;
  guildId?: string;
  channelId?: string;
  firstMessageId?: string;
  /** Set when Python gather verified reachability at retrieve time. */
  verified?: boolean;
}

export interface EvidenceClaim {
  claim: string;
  quote: string;
  url: string;
  /** Public URL used in Sources / Discord embed (https or discord.com jump). */
  citationUrl: string;
  sourceIndex: number;
  authority: EvidenceAuthority;
}

const HOST_AUTHORITY_SCORE: Readonly<Record<string, number>> = loadLinguistics().hostAuthorityScores;

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
  readonly guildId?: string;
  readonly channelId?: string;
  readonly firstMessageId?: string;
  readonly verified?: boolean;
}

const passageLocator = (passage: EvidencePassage | RetrievePassageRow): DiscordPassageLocator => {
  const guildId = "guildId" in passage ? passage.guildId?.trim() : "";
  const channelId = "channelId" in passage ? passage.channelId?.trim() : "";
  const firstMessageId = "firstMessageId" in passage ? passage.firstMessageId?.trim() : "";
  return {
    ...(guildId ? { guildId } : {}),
    ...(channelId ? { channelId } : {}),
    ...(firstMessageId ? { firstMessageId } : {}),
  };
};

export const passagesFromRetrieveRows = (rows: readonly RetrievePassageRow[]): EvidencePassage[] => {
  const passages: EvidencePassage[] = [];
  for (const row of rows) {
    const text = row.quote.trim();
    const url = row.url.trim();
    if (!text || !url) continue;
    const host = (row.host?.trim() || hostFromUrl(url) || "source").toLowerCase();
    const guildId = row.guildId?.trim();
    const channelId = row.channelId?.trim();
    const firstMessageId = row.firstMessageId?.trim();
    passages.push({
      text,
      url,
      host,
      authority: passageAuthority(url),
      ...(row.verified === true ? { verified: true } : {}),
      ...(guildId ? { guildId } : {}),
      ...(channelId ? { channelId } : {}),
      ...(firstMessageId ? { firstMessageId } : {}),
    });
  }
  return passages;
};

export const publicCitationUrlForPassage = (passage: EvidencePassage): string =>
  resolvePublicCitationUrl(passage.url, passageLocator(passage));

export const publicCitationUrlForClaim = (claim: EvidenceClaim): string => claim.citationUrl;

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
          citationUrl: publicCitationUrlForPassage(passage),
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
          citationUrl: publicCitationUrlForPassage(passage),
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
    const key = claim.citationUrl || claim.url;
    let index = urlToIndex.get(key);
    if (!index) {
      index = next;
      urlToIndex.set(key, index);
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
        const passage = evidencePassages.find((p) => p.url === url);
        const citationUrl = passage ? publicCitationUrlForPassage(passage) : url;
        return {
          claim: row.claim!.trim(),
          quote: row.quote!.trim(),
          url,
          citationUrl,
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

export type GroundedComposeProfile = "full" | "brief";

const queryTokens = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 2);

const haystackIncludesToken = (haystack: string, token: string): boolean => {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "iu").test(haystack);
};

const anchorTokensForQuery = (query: string): string[] => {
  const tokens = queryTokens(query).filter((token) => !genericQueryTokenSet().has(token));
  if (tokens.length === 0) return queryTokens(query);
  return [...tokens].sort((left, right) => right.length - left.length);
};

/** Distinctive tokens for anchoring (intent vocabulary + long non-generic query tokens). */
export const distinctiveAnchorTokens = (query: string): string[] => {
  const intent = classifyQueryIntent(query);
  const linguistics = loadLinguistics();
  const intentVocabulary =
    intent === "general" ? [] : [...linguistics.intentTerms[intent]];
  const fromQuery = anchorTokensForQuery(query);
  const generic = genericQueryTokenSet();

  const distinctive = fromQuery.filter(
    (token) =>
      intentVocabulary.some((term: string) => term.includes(token) || token.includes(term))
      || (token.length >= 5 && !generic.has(token)),
  );

  if (distinctive.length > 0) {
    return [...new Set(distinctive)];
  }
  return fromQuery.length > 0 ? [fromQuery[0]!] : [];
};

/** Brief compose: prefer claims that mention the query's distinctive token(s). */
export const claimMatchesQueryAnchor = (claim: EvidenceClaim, query: string): boolean => {
  const haystack = `${claim.claim} ${claim.quote}`.toLowerCase();
  const anchors = distinctiveAnchorTokens(query);
  return anchors.some((token) => haystackIncludesToken(haystack, token));
};

export const passageMatchesQueryAnchor = (passage: EvidencePassage, query: string): boolean => {
  const haystack = passage.text.toLowerCase();
  return distinctiveAnchorTokens(query).some((token) => haystackIncludesToken(haystack, token));
};

export const rankClaimsForQuery = (
  claims: readonly EvidenceClaim[],
  query: string,
): EvidenceClaim[] => {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [...claims];

  const scoreClaim = (claim: EvidenceClaim): number => {
    const haystack = `${claim.claim} ${claim.quote}`.toLowerCase();
    let hits = 0;
    for (const token of tokens) {
      if (haystackIncludesToken(haystack, token)) hits += 1;
    }
    const anchorBonus = claimMatchesQueryAnchor(claim, query) ? 12 : 0;
    return hits * 5 + anchorBonus + authorityScore(claim.url);
  };

  return [...claims].sort((left, right) => scoreClaim(right) - scoreClaim(left));
};

export const selectQueryAnchoredClaims = (
  claims: readonly EvidenceClaim[],
  query: string,
  maxClaims: number,
): EvidenceClaim[] => {
  const ranked = rankClaimsForQuery(assignSourceIndices([...claims]), query);
  const anchored = ranked.filter((claim) => claimMatchesQueryAnchor(claim, query));
  const pool = anchored.length >= 2 ? anchored : anchored.length > 0 ? anchored : ranked;
  return pool.slice(0, maxClaims);
};

export const passagesAnchoredForQuery = (
  passages: readonly EvidencePassage[],
  query: string,
): EvidencePassage[] => {
  const anchored = passages.filter((passage) => passageMatchesQueryAnchor(passage, query));
  return anchored.length > 0 ? [...anchored] : [...passages].slice(0, 3);
};

/** Up to N brief lines with distinct public citation URLs (https or discord jump). */
export const selectDistinctBriefClaims = (
  claims: readonly EvidenceClaim[],
  query: string,
  maxLines: number,
): EvidenceClaim[] => {
  const ranked = rankClaimsForQuery(assignSourceIndices([...claims]), query);
  const anchored = ranked.filter((claim) => claimMatchesQueryAnchor(claim, query));
  const pool = anchored.length >= maxLines ? anchored : ranked;
  const picked: EvidenceClaim[] = [];
  const seen = new Set<string>();
  const tryPick = (claims: readonly EvidenceClaim[], requireAnchor: boolean): void => {
    for (const claim of claims) {
      if (requireAnchor && !claimMatchesQueryAnchor(claim, query)) continue;
      const pub = publicCitationUrlForClaim(claim);
      if (!pub.startsWith("http")) continue;
      if (seen.has(pub)) continue;
      seen.add(pub);
      picked.push(claim);
      if (picked.length >= maxLines) break;
    }
  };

  tryPick(pool, anchored.length > 0);
  if (picked.length < MIN_WEB_CITATIONS && maxLines >= MIN_WEB_CITATIONS) {
    const tokens = queryTokens(query);
    const tokenMatched = ranked.filter((claim) => {
      if (tokens.length === 0) return true;
      const haystack = `${claim.claim} ${claim.quote}`.toLowerCase();
      return tokens.some((token) => haystackIncludesToken(haystack, token));
    });
    tryPick(tokenMatched.length > 0 ? tokenMatched : ranked, false);
  }
  return picked;
};

const selectBriefClaims = (claims: readonly EvidenceClaim[], query: string): EvidenceClaim[] =>
  selectDistinctBriefClaims(claims, query, BRIEF_MAX_CLAIM_LINES);

export const selectHolocronFullClaims = (
  claims: readonly EvidenceClaim[],
  query: string,
): EvidenceClaim[] => {
  const distinct = selectDistinctBriefClaims(claims, query, HOLOCRON_FULL_MAX_CLAIM_LINES);
  if (distinct.length >= MIN_WEB_CITATIONS) return distinct;
  return selectQueryAnchoredClaims(claims, query, HOLOCRON_FULL_MAX_CLAIM_LINES);
};

export const composeGroundedAnswerFromClaims = (
  query: string,
  claims: readonly EvidenceClaim[],
  sources: readonly SourceDescriptor[],
  profile: GroundedComposeProfile = "full",
): string => {
  const indexed =
    profile === "brief"
      ? selectBriefClaims(claims, query)
      : selectHolocronFullClaims(claims, query);
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

  const stripClaimTitle = (claim: string): string => {
    const flattened = claim
      .replace(/^#{1,6}\s+/u, "")
      .replace(/\s+#+\s+/u, " ")
      .replace(/\s+/g, " ")
      .trim();
    const duplicateLead = flattened.match(/^(\S+)\s+\1\b/iu);
    return duplicateLead ? flattened.slice(duplicateLead[1]!.length).trimStart() : flattened;
  };

  const composeClaims = indexed;
  const bullets =
    profile === "brief"
      ? composeClaims.map((claim) => `${stripClaimTitle(claim.claim)} [${claim.sourceIndex}]`)
      : composeClaims.map((claim) => `- ${claim.claim} [${claim.sourceIndex}]`);
  const caveat =
    profile === "brief" || conflictHosts.size === 0
      ? ""
      : "\n\nCaveats: Sources disagree on details; compare the cited pages before installing.";

  const orderedSources: SourceDescriptor[] = [];
  const normalize = (url: string): string => url.trim().replace(/\/+$/u, "");
  for (const claim of composeClaims) {
    const match = sources.find(
      (source) => normalize(source.homeUrl) === normalize(publicCitationUrlForClaim(claim)),
    );
    if (match && !orderedSources.some((entry) => normalize(entry.homeUrl) === normalize(match.homeUrl))) {
      orderedSources.push(match);
    }
  }

  const summaryLead =
    profile === "brief" || composeClaims.length === 0
      ? ""
      : `${stripClaimTitle(composeClaims[0]!.claim).replace(/\s+\[\d+\]\s*$/u, "").trim()} [${composeClaims[0]!.sourceIndex}]`;
  const body =
    profile === "brief"
      ? [...bullets, caveat].filter(Boolean).join("\n").trim()
      : [summaryLead, summaryLead ? "" : "", ...bullets, caveat].filter(Boolean).join("\n").trim();
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
  profile: GroundedComposeProfile = "full",
): Promise<string | null> => {
  const indexed =
    profile === "brief" ? selectBriefClaims(claims, query) : assignSourceIndices([...claims]);
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
          profile === "brief"
            ? loadPromptTemplate("grounded-brief")
            : loadPromptTemplate("grounded-full"),
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
      if (haystackIncludesToken(haystack, token)) hits += 1;
    }
    const anchorBonus = passageMatchesQueryAnchor(passage, query) ? 12 : 0;
    return hits * 4 + anchorBonus + authorityScore(passage.url);
  };

  return [...passages].sort((left, right) => scorePassage(right) - scorePassage(left));
};

/** One claim per distinct https passage (offline / no-LLM compose when sentence heuristics are thin). */
export const claimsFromDistinctPassages = (
  passages: readonly EvidencePassage[],
  maxClaims = 6,
  query?: string,
): EvidenceClaim[] => {
  let pool = [...passages];
  if (query) {
    const ranked = rankPassagesForQuery(pool, query);
    const anchored = ranked.filter((passage) => passageMatchesQueryAnchor(passage, query));
    if (anchored.length >= MIN_WEB_CITATIONS) {
      pool = anchored;
    } else if (anchored.length > 0) {
      const anchoredUrls = new Set(anchored.map((passage) => publicCitationUrlForPassage(passage)));
      const extraAnchored = ranked.filter(
        (passage) =>
          !anchoredUrls.has(publicCitationUrlForPassage(passage))
          && passageMatchesQueryAnchor(passage, query),
      );
      pool = [...anchored, ...extraAnchored];
      if (pool.length < MIN_WEB_CITATIONS) {
        const tokens = queryTokens(query);
        const tokenMatched = ranked.filter((passage) => {
          if (anchoredUrls.has(publicCitationUrlForPassage(passage))) return false;
          if (extraAnchored.some((extra) => publicCitationUrlForPassage(extra) === publicCitationUrlForPassage(passage))) {
            return false;
          }
          if (tokens.length === 0) return true;
          return tokens.some((token) => haystackIncludesToken(passage.text.toLowerCase(), token));
        });
        pool = [...pool, ...tokenMatched];
      }
    } else {
      pool = ranked;
    }
  }

  const claims: EvidenceClaim[] = [];
  const seenUrls = new Set<string>();
  for (const passage of pool) {
    const citationUrl = publicCitationUrlForPassage(passage);
    if (!citationUrl.startsWith("http")) continue;
    if (seenUrls.has(citationUrl)) continue;
    const text = passage.text.replace(/\s+/g, " ").trim();
    if (text.length < 24) continue;
    const claimText = text.length > 280 ? `${text.slice(0, 277)}…` : text;
    claims.push({
      claim: claimText,
      quote: text.length > 500 ? `${text.slice(0, 497)}…` : text,
      url: passage.url,
      citationUrl,
      sourceIndex: 0,
      authority: passage.authority,
    });
    seenUrls.add(citationUrl);
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

/** Holocron: standard 2-URL bar, or one strong on-topic anchored web claim (small QA index). */
export const hasMinimumHolocronGroundedSupport = (
  claims: readonly EvidenceClaim[],
  query: string,
): boolean => {
  if (hasMinimumGroundedSupport(claims)) return true;
  return hasMinimumBriefGroundedSupport(claims, query);
};

export const countDistinctPublicCitationUrls = (claims: readonly EvidenceClaim[]): number =>
  new Set(
    claims
      .map(publicCitationUrlForClaim)
      .filter((url) => url.startsWith("http") || isDiscordJumpUrl(url)),
  ).size;

/** Discord brief: ≥2 distinct public citation URLs and at least one query-anchored claim. */
export const hasMinimumDiscordBriefGroundedSupport = (
  claims: readonly EvidenceClaim[],
  query: string,
): boolean => {
  if (countDistinctPublicCitationUrls(claims) < BRIEF_DISCORD_MIN_CITATIONS) return false;
  return claims.some((claim) => claimMatchesQueryAnchor(claim, query));
};

/** Legacy Holocron small-index escape hatch (not used for Discord /ask). */
export const hasMinimumBriefGroundedSupport = (
  claims: readonly EvidenceClaim[],
  query: string,
): boolean => {
  const webClaims = claims.filter((claim) => claim.citationUrl.startsWith("https://"));
  if (webClaims.length < 1) return false;
  return webClaims.some((claim) => claimMatchesQueryAnchor(claim, query));
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

/** Whether retrieved passages can support a multi-source grounded answer (2026 sufficiency bar). */
export const hasSufficientPassagesForGrounding = (
  passages: readonly EvidencePassage[],
  query: string,
  minDistinctUrls: number = MIN_WEB_CITATIONS,
): boolean => {
  const web = passages.filter((p) => p.url.startsWith("https://"));
  const hosts = new Set(web.map((p) => p.url));
  if (hosts.size < minDistinctUrls) return false;
  const tokens = distinctiveAnchorTokens(query);
  if (tokens.length === 0) return hosts.size >= minDistinctUrls;
  const anchored = web.filter((p) =>
    tokens.some((token) => haystackIncludesToken(`${p.url} ${p.text}`.toLowerCase(), token)),
  );
  return anchored.length >= 1 && hosts.size >= minDistinctUrls;
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
  // Insufficient citations: failed (not partial) so UI does not imply a complete answer.
  if (indices.length > 0 || citedSourceCount > 0) {
    return "failed";
  }
  return "failed";
};
