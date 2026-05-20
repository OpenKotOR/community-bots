import { z } from "zod";

import { loadValidatedJson } from "./json-load.js";
import { traskDataPath } from "./repo-root.js";

const PolicySchema = z.object({
  version: z.number().int().positive(),
  minWebCitations: z.number().int().positive(),
  degradedAnswerPatterns: z.array(z.string().min(1)),
  discord: z.object({
    maxBodyLines: z.number().int().positive(),
    maxLineChars: z.number().int().positive(),
    descriptionMaxLength: z.number().int().positive(),
  }),
  holocron: z.object({
    minHttpsSources: z.number().int().positive(),
    minAnswerLength: z.number().int().positive(),
  }),
});

export type TraskPolicy = z.infer<typeof PolicySchema>;

let cachedPolicy: TraskPolicy | null = null;

const policyPath = (): string => {
  const override = process.env.TRASK_POLICY_PATH?.trim();
  if (override) return override;
  return traskDataPath("policy.json");
};

export const loadTraskPolicy = (): TraskPolicy => {
  if (cachedPolicy) return cachedPolicy;
  const loaded = loadValidatedJson(policyPath(), PolicySchema);
  const minOverride = Number(process.env.TRASK_MIN_WEB_CITATIONS);
  cachedPolicy = {
    ...loaded,
    minWebCitations: Number.isFinite(minOverride) && minOverride > 0 ? minOverride : loaded.minWebCitations,
  };
  return cachedPolicy;
};

export const degradedAnswerRegexes = (): RegExp[] => {
  return loadTraskPolicy().degradedAnswerPatterns.map((pattern) => new RegExp(pattern, "i"));
};

export const isDegradedAnswer = (text: string): boolean => {
  return degradedAnswerRegexes().some((re) => re.test(text));
};

export const clearPolicyCache = (): void => {
  cachedPolicy = null;
};
