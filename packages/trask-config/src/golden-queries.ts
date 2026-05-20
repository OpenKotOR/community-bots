import { join } from "node:path";

import { z } from "zod";

import { loadValidatedJson } from "./json-load.js";
import { resolveRepoRoot, traskDataPath } from "./repo-root.js";

const GoldenFixtureSchema = z.object({
  url: z.string().url(),
  sourceId: z.string().min(1),
  host: z.string().min(1),
  markdown: z.string().min(1),
  mustContain: z.string().min(1),
});

const GoldenQuerySchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  expectPattern: z.string().min(1),
  sourcePattern: z.string().min(1),
  minCitations: z.number().int().positive().optional(),
  intent: z.enum(["tooling", "technical", "lore", "general"]).optional(),
  surfaces: z.array(z.string()).optional(),
  fixture: GoldenFixtureSchema.optional(),
});

const GoldenQueriesFileSchema = z.object({
  version: z.number().int().positive(),
  queries: z.array(GoldenQuerySchema).min(1),
});

export type GoldenFixture = z.infer<typeof GoldenFixtureSchema>;
export type GoldenQuery = z.infer<typeof GoldenQuerySchema>;
export type GoldenQueriesFile = z.infer<typeof GoldenQueriesFileSchema>;

export type GoldenQueryRuntime = GoldenQuery & {
  expectRe: RegExp;
  sourceRe: RegExp;
};

let cachedGolden: GoldenQueriesFile | null = null;
let cachedRuntime: GoldenQueryRuntime[] | null = null;

const goldenQueriesPath = (): string => {
  const override = process.env.TRASK_GOLDEN_QUERIES_PATH?.trim();
  if (override) return override;
  return traskDataPath("eval", "golden-queries.json");
};

const toRuntime = (query: GoldenQuery): GoldenQueryRuntime => ({
  ...query,
  expectRe: new RegExp(query.expectPattern, "i"),
  sourceRe: new RegExp(query.sourcePattern, "i"),
});

export const loadGoldenQueriesFile = (path = goldenQueriesPath()): GoldenQueriesFile => {
  return loadValidatedJson(path, GoldenQueriesFileSchema);
};

export const loadGoldenQueries = (): GoldenQueryRuntime[] => {
  if (cachedRuntime) return cachedRuntime;
  cachedGolden = loadGoldenQueriesFile();
  cachedRuntime = cachedGolden.queries.map(toRuntime);
  return cachedRuntime;
};

export const getGoldenQuery = (id: string): GoldenQueryRuntime | undefined => {
  return loadGoldenQueries().find((entry) => entry.id === id);
};

export const goldenQueriesForSurface = (surface: string): GoldenQueryRuntime[] => {
  return loadGoldenQueries().filter((entry) => !entry.surfaces?.length || entry.surfaces.includes(surface));
};

export const goldenFixtures = (): Array<GoldenFixture & { query: string; id: string }> => {
  return loadGoldenQueries()
    .filter((entry): entry is GoldenQueryRuntime & { fixture: GoldenFixture } => Boolean(entry.fixture))
    .map((entry) => ({
      ...entry.fixture,
      query: entry.question,
      id: entry.id,
    }));
};

/** Legacy path for scripts still pointing at data/trask-eval/golden-queries.json */
export const legacyGoldenQueriesPath = (): string => {
  return join(resolveRepoRoot(), "data", "trask-eval", "golden-queries.json");
};

export const clearGoldenQueriesCache = (): void => {
  cachedGolden = null;
  cachedRuntime = null;
};
