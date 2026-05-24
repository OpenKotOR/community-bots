import {
  classifyQueryIntent,
  genericQueryTokenSet,
  loadLinguistics,
} from "@openkotor/trask-config";

/** Minimum distinct inline citations for brief Discord display and compose sufficiency. */
export const BRIEF_DISCORD_MIN_CITATIONS = 2;

const queryTokens = (query: string): string[] =>
  query
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 2);

const isTokenBoundaryChar = (ch: string | undefined): boolean =>
  ch === undefined || !/[a-z0-9]/iu.test(ch);

/** Word-boundary token match without dynamic RegExp (CodeQL-safe on user queries). */
export const haystackIncludesToken = (haystack: string, token: string): boolean => {
  const lowerHaystack = haystack.toLowerCase();
  const lowerToken = token.toLowerCase();
  if (!lowerToken) return false;
  let i = 0;
  while (i <= lowerHaystack.length - lowerToken.length) {
    const at = lowerHaystack.indexOf(lowerToken, i);
    if (at === -1) return false;
    const before = at === 0 ? undefined : lowerHaystack[at - 1];
    const after = lowerHaystack[at + lowerToken.length];
    if (isTokenBoundaryChar(before) && isTokenBoundaryChar(after)) return true;
    i = at + 1;
  }
  return false;
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

export type QueryAnchorClaim = { claim: string; quote: string };

/** Brief compose / display: prefer claims that mention the query's distinctive token(s). */
export const claimMatchesQueryAnchor = (claim: QueryAnchorClaim, query: string): boolean => {
  const haystack = `${claim.claim} ${claim.quote}`.toLowerCase();
  const anchors = distinctiveAnchorTokens(query);
  return anchors.some((token) => haystackIncludesToken(haystack, token));
};

export type QueryAnchorPassage = { text: string };

export const passageMatchesQueryAnchor = (passage: QueryAnchorPassage, query: string): boolean => {
  const haystack = passage.text.toLowerCase();
  return distinctiveAnchorTokens(query).some((token) => haystackIncludesToken(haystack, token));
};
