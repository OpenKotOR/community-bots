#!/usr/bin/env node
/**
 * Shared Trask script bootstrap: repo root + dotenv + optional config path hints.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveRepoRoot } from "../../packages/trask-config/dist/repo-root.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolveRepoRoot(scriptDir);

export const loadEnvFiles = (root = repoRoot) => {
  for (const rel of [".env", ".env.local"]) {
    const path = resolve(root, rel);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
};
