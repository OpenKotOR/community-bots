import { z } from "zod";

import { loadValidatedJson } from "./json-load.js";
import { traskDataPath } from "./repo-root.js";

const VerificationQuerySchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  expectPattern: z.string().min(1),
  sourcePattern: z.string().min(1),
  forbidPattern: z.string().optional(),
  minCitations: z.number().int().positive().optional(),
  surfaces: z.array(z.string()).optional(),
});

const VerificationQueriesFileSchema = z.object({
  version: z.number().int().positive(),
  queries: z.array(VerificationQuerySchema).min(1),
});

export type VerificationQuery = z.infer<typeof VerificationQuerySchema>;

export type VerificationQueryRuntime = VerificationQuery & {
  expectRe: RegExp;
  sourceRe: RegExp;
  forbidRe: RegExp | null;
};

let cachedRuntime: VerificationQueryRuntime[] | null = null;

const verificationQueriesPath = (): string => {
  const override = process.env.TRASK_VERIFICATION_QUERIES_PATH?.trim();
  if (override) return override;
  return traskDataPath("eval", "verification-queries.json");
};

const toRuntime = (query: VerificationQuery): VerificationQueryRuntime => ({
  ...query,
  expectRe: new RegExp(query.expectPattern, "i"),
  sourceRe: new RegExp(query.sourcePattern, "i"),
  forbidRe: query.forbidPattern ? new RegExp(query.forbidPattern, "i") : null,
});

export const loadVerificationQueries = (): VerificationQueryRuntime[] => {
  if (cachedRuntime) return cachedRuntime;
  const file = loadValidatedJson(verificationQueriesPath(), VerificationQueriesFileSchema);
  cachedRuntime = file.queries.map(toRuntime);
  return cachedRuntime;
};

export const verificationQueriesForSurface = (surface: string): VerificationQueryRuntime[] => {
  return loadVerificationQueries().filter(
    (entry) => !entry.surfaces?.length || entry.surfaces.includes(surface),
  );
};

export const clearVerificationQueriesCache = (): void => {
  cachedRuntime = null;
};
