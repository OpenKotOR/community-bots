import { z } from "zod";

import { loadValidatedJson } from "./json-load.js";
import { traskDataPath } from "./repo-root.js";

const IntentTermsSchema = z.object({
  tooling: z.array(z.string()),
  technical: z.array(z.string()),
  lore: z.array(z.string()),
});

const IntentTagBoostSchema = z.object({
  boostTags: z.array(z.string()).optional(),
  penalizeLoreOnly: z.number().optional(),
  boostTooling: z.number().optional(),
  boostLore: z.number().optional(),
  penalizeToolingOnly: z.number().optional(),
});

const LinguisticsSchema = z.object({
  version: z.number().int().positive(),
  genericQueryTokens: z.array(z.string()),
  intentTerms: IntentTermsSchema,
  loreSourceIds: z.array(z.string()),
  hostAuthorityScores: z.record(z.number()),
  intentTagBoosts: z.record(IntentTagBoostSchema).optional(),
});

export type TraskLinguistics = z.infer<typeof LinguisticsSchema>;
export type QueryIntent = "tooling" | "technical" | "lore" | "general";

let cachedLinguistics: TraskLinguistics | null = null;

const linguisticsPath = (): string => {
  const override = process.env.TRASK_LINGUISTICS_PATH?.trim();
  if (override) return override;
  return traskDataPath("linguistics.json");
};

export const loadLinguistics = (): TraskLinguistics => {
  if (cachedLinguistics) return cachedLinguistics;
  cachedLinguistics = loadValidatedJson(linguisticsPath(), LinguisticsSchema);
  return cachedLinguistics;
};

const queryIncludesAny = (query: string, terms: readonly string[]): boolean => {
  const lowered = query.toLowerCase();
  return terms.some((term) => lowered.includes(term));
};

export const classifyQueryIntent = (query: string): QueryIntent => {
  const { intentTerms } = loadLinguistics();
  // Technical before tooling — "TSL mods" must not beat save-location questions.
  if (queryIncludesAny(query, intentTerms.technical)) return "technical";
  if (queryIncludesAny(query, intentTerms.tooling)) return "tooling";
  if (queryIncludesAny(query, intentTerms.lore)) return "lore";
  return "general";
};

export const genericQueryTokenSet = (): ReadonlySet<string> => {
  return new Set(loadLinguistics().genericQueryTokens.map((token) => token.toLowerCase()));
};

export const loreSourceIdSet = (): ReadonlySet<string> => {
  return new Set(loadLinguistics().loreSourceIds);
};

export const intentScoreDelta = (intent: QueryIntent, tags: readonly string[]): number => {
  const linguistics = loadLinguistics();
  const boosts = linguistics.intentTagBoosts ?? {};
  const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));
  const hasTag = (candidates: readonly string[] | undefined): boolean => {
    if (!candidates?.length) return false;
    return candidates.some((tag) => tagSet.has(tag.toLowerCase()));
  };

  const loreTags = boosts.lore?.boostTags ?? ["lore", "story", "characters", "companions", "quests", "walkthrough", "gameplay"];
  const toolingTags = boosts.tooling?.boostTags
    ?? ["tooling", "formats", "reference", "automation", "python", "engine", "conversion", "assets", "textures", "mods", "forum", "support", "fixes", "troubleshooting", "compatibility"];

  const hasLore = hasTag(loreTags);
  const hasTooling = hasTag(toolingTags);

  if (intent === "tooling" || intent === "technical") {
    const cfg = boosts.tooling ?? boosts.technical;
    if (hasLore && !hasTooling) return cfg?.penalizeLoreOnly ?? -12;
    if (hasTooling) return cfg?.boostTooling ?? 6;
  }
  if (intent === "lore") {
    const cfg = boosts.lore;
    if (hasLore) return cfg?.boostLore ?? 6;
    if (hasTooling && !hasLore) return cfg?.penalizeToolingOnly ?? -4;
  }
  return 0;
};

export const clearLinguisticsCache = (): void => {
  cachedLinguistics = null;
};
