import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let cachedRepoRoot: string | null = null;

export const resolveRepoRoot = (startDir?: string): string => {
  if (cachedRepoRoot) return cachedRepoRoot;

  const start = startDir ?? dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (let depth = 0; depth < 12; depth += 1) {
    if (
      existsSync(join(dir, "pnpm-workspace.yaml"))
      && existsSync(join(dir, "data", "trask", "eval", "golden-queries.json"))
    ) {
      cachedRepoRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  cachedRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  return cachedRepoRoot;
};

export const traskDataPath = (...segments: string[]): string => {
  return join(resolveRepoRoot(), "data", "trask", ...segments);
};
