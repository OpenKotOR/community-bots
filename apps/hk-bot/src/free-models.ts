import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Logger } from "@openkotor/core";

export interface FreeModelResolverOptions {
  readonly repoRoot?: string;
  readonly pythonExecutable?: string;
  readonly timeoutMs?: number;
}

const FREE_MODEL_RE = /(^|[/:_-])free($|[/:_-])|:free$/i;

export const filterFreeChatModels = (models: readonly string[]): string[] => {
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const model of models) {
    const trimmed = model.trim();

    if (!trimmed || trimmed === "openrouter/auto" || !FREE_MODEL_RE.test(trimmed)) {
      continue;
    }

    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      filtered.push(trimmed);
    }
  }

  return filtered;
};

export const parseFallbackModelOutput = (output: string): string[] => {
  try {
    const parsed = JSON.parse(output) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
};

const resolveRepoRoot = (): string => {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "../../..");
};

export const resolveFreeChatModels = async (
  logger: Pick<Logger, "warn" | "debug">,
  options: FreeModelResolverOptions = {},
): Promise<string[]> => {
  const repoRoot = options.repoRoot ?? resolveRepoRoot();
  const python = options.pythonExecutable ?? process.env.HK_LLM_FALLBACKS_PYTHON ?? "python3";
  const timeoutMs = options.timeoutMs ?? 5000;
  const script = [
    "import json, sys",
    `sys.path.insert(0, ${JSON.stringify(join(repoRoot, "vendor", "llm_fallbacks", "src"))})`,
    "from llm_fallbacks import get_fallback_list",
    "print(json.dumps(list(get_fallback_list('chat'))))",
  ].join("\n");

  return await new Promise<string[]>((resolveModels) => {
    const child = spawn(python, ["-c", script], {
      cwd: repoRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      logger.warn("HK free-model resolver timed out; LLM replies will fail closed.", { timeoutMs });
      resolveModels([]);
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      logger.warn("HK free-model resolver failed to start; LLM replies will fail closed.", { error: error.message });
      resolveModels([]);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        logger.warn("HK free-model resolver exited unsuccessfully; LLM replies will fail closed.", {
          code,
          stderr: stderr.trim().slice(0, 500),
        });
        resolveModels([]);
        return;
      }

      const models = filterFreeChatModels(parseFallbackModelOutput(stdout));

      if (models.length === 0) {
        logger.warn("HK free-model resolver returned no explicit free models; LLM replies will fail closed.");
      } else {
        logger.debug("HK free-model resolver loaded explicit free models.", { count: models.length });
      }

      resolveModels(models);
    });
  });
};

export const loadFreeChatModels = async (
  logger: Pick<Logger, "warn" | "debug">,
  options: FreeModelResolverOptions = {},
): Promise<string[]> => resolveFreeChatModels(logger, options);
