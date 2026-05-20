import { z } from "zod";

import { loadValidatedJson } from "./json-load.js";
import { traskDataPath } from "./repo-root.js";

const RetrievalDefaultsSchema = z.object({
  version: z.number().int().positive(),
  retrieveLimit: z.number().int().positive(),
  maxPassages: z.number().int().positive(),
  indexerDefaultLimit: z.number().int().positive(),
  maxDdgResults: z.number().int().positive(),
  fetchTimeoutMs: z.number().int().positive(),
  researchTimeoutMs: z.number().int().positive(),
});

export type TraskRetrievalDefaults = z.infer<typeof RetrievalDefaultsSchema>;

let cachedDefaults: TraskRetrievalDefaults | null = null;

export const retrievalDefaultsPath = (): string => {
  const override = process.env.TRASK_RETRIEVAL_DEFAULTS_PATH?.trim();
  if (override) return override;
  return traskDataPath("retrieval.defaults.json");
};

export const loadRetrievalDefaults = (): TraskRetrievalDefaults => {
  if (cachedDefaults) return cachedDefaults;
  cachedDefaults = loadValidatedJson(retrievalDefaultsPath(), RetrievalDefaultsSchema);
  return cachedDefaults;
};

export const clearRetrievalDefaultsCache = (): void => {
  cachedDefaults = null;
};
