import { readFileSync } from "node:fs";

import type { ZodType } from "zod";

export const readJsonFile = (path: string): unknown => {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
};

export const loadValidatedJson = <T>(path: string, schema: ZodType<T>): T => {
  const raw = readJsonFile(path);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid Trask config at ${path}: ${detail}`);
  }
  return parsed.data;
};
