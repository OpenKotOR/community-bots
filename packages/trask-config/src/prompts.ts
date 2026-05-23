import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { traskDataPath } from "./repo-root.js";

const promptCache = new Map<string, string>();

const promptDir = (): string => {
  const override = process.env.TRASK_PROMPT_DIR?.trim();
  if (override) return override;
  return traskDataPath("prompts");
};

const stripFrontmatter = (raw: string): string => {
  if (!raw.startsWith("---")) return raw.trim();
  const end = raw.indexOf("---", 3);
  if (end === -1) return raw.trim();
  return raw.slice(end + 3).trim();
};

export const loadPromptTemplate = (templateId: string): string => {
  const cached = promptCache.get(templateId);
  if (cached) return cached;

  const dir = promptDir();
  const candidates = [
    join(dir, `${templateId}.md`),
    ...readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => join(dir, entry.name)),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf8");
    const body = stripFrontmatter(raw);
    const idMatch = raw.match(/^---[\s\S]*?id:\s*([^\n]+)/m);
    const fileId = idMatch?.[1]?.trim();
    if (fileId === templateId || path.endsWith(`${templateId}.md`)) {
      promptCache.set(templateId, body);
      return body;
    }
  }

  throw new Error(`Trask prompt template not found: ${templateId} (dir: ${dir})`);
};

export const clearPromptCache = (): void => {
  promptCache.clear();
};
