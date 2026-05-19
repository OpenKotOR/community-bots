import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type { WebResearchRuntimeConfig } from "@openkotor/config";

export interface HeadlessWebResearchResult {
  readonly report: string;
  readonly research_information?: {
    readonly source_urls?: readonly string[] | null;
    readonly cited_urls?: readonly string[] | null;
    readonly retrieved_urls?: readonly string[] | null;
    readonly visited_urls?: readonly string[] | null;
    readonly query_domains?: readonly string[] | null;
    readonly allowed_url_prefixes?: readonly string[] | null;
    readonly rejected_source_urls?: readonly string[] | null;
  };
}

export interface HeadlessWebResearchModelOption {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly recommended?: boolean;
}

/** stdin payload for `scripts/trask_web_research.py`. */
export interface HeadlessWebResearchRequestPayload {
  readonly query: string;
  readonly custom_prompt?: string;
  readonly source_urls?: readonly string[];
  readonly query_domains?: readonly string[];
  readonly allowed_url_prefixes?: readonly string[];
  readonly model?: string;
  readonly report_type?: string;
  readonly report_source?: string;
}

/** @deprecated Use HeadlessWebResearchResult */
export type HeadlessAiResearchWizardResult = HeadlessWebResearchResult;

/** @deprecated Use HeadlessWebResearchRequestPayload */
export type HeadlessAiResearchWizardRequestPayload = HeadlessWebResearchRequestPayload;

/** @deprecated Use HeadlessWebResearchModelOption */
export type HeadlessAiResearchWizardModelOption = HeadlessWebResearchModelOption;

const findRepoRoot = (startDir: string, maxHops = 24): string => {
  let dir = resolve(startDir);
  for (let hop = 0; hop < maxHops; hop++) {
    const script = join(dir, "scripts", "trask_web_research.py");
    if (existsSync(script)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return process.cwd();
    }
    dir = parent;
  }
  return process.cwd();
};

const defaultScriptPath = (repoRoot: string): string => join(repoRoot, "scripts", "trask_web_research.py");

const spawnHeadless = (
  python: string,
  script: string,
  cwd: string,
  payload: HeadlessWebResearchRequestPayload,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(python, [script], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        TRASK_ALLOWED_QUERY_DOMAINS: (payload.query_domains ?? []).join("\n"),
        TRASK_ALLOWED_URL_PREFIXES: (payload.allowed_url_prefixes ?? []).join("\n"),
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });

    const chunksOut: Buffer[] = [];
    const chunksErr: Buffer[] = [];
    let settled = false;

    child.stdout?.on("data", (chunk: Buffer | string) => {
      chunksOut.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      chunksErr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGTERM");
      rejectPromise(new Error(`Trask web research runner timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      rejectPromise(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolvePromise({
        stdout: Buffer.concat(chunksOut).toString("utf8").trim(),
        stderr: Buffer.concat(chunksErr).toString("utf8").trim(),
        code: exitCode,
      });
    });

    try {
      child.stdin?.write(Buffer.from(JSON.stringify(payload), "utf8"));
      child.stdin?.end();
    } catch (error) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        rejectPromise(error);
      }
    }
  });
};

export const runHeadlessWebResearch = async (
  config: WebResearchRuntimeConfig,
  payload: HeadlessWebResearchRequestPayload,
): Promise<HeadlessWebResearchResult> => {
  const repoRoot = config.repoRoot?.trim() || findRepoRoot(process.cwd());
  const script = (config.headlessScriptPath?.trim() || defaultScriptPath(repoRoot)).trim();

  if (!existsSync(script)) {
    throw new Error(
      `Trask web research script not found: ${script}. Run scripts/bootstrap_trask_research.sh or set TRASK_WEB_RESEARCH_SCRIPT.`,
    );
  }

  const python = config.pythonExecutable?.trim() || "python";
  const { stdout, stderr, code } = await spawnHeadless(python, script, repoRoot, payload, config.timeoutMs);

  if (code !== 0) {
    throw new Error(`Trask web research runner exited ${code ?? "unknown"}: ${stderr || stdout || "no output"}`);
  }

  try {
    const parsed = JSON.parse(stdout) as HeadlessWebResearchResult;

    if (typeof parsed.report !== "string" || !parsed.report.trim()) {
      throw new Error("Web research runner returned empty report.");
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Trask web research runner returned invalid JSON: ${stdout.slice(0, 400)}`);
    }

    throw error;
  }
};

/** @deprecated Use runHeadlessWebResearch */
export const runHeadlessGptResearcher = runHeadlessWebResearch;

const labelFromModelId = (modelId: string): string => {
  const tail = modelId.split("/").pop() ?? modelId;
  return tail
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (char) => char.toUpperCase())
    .replace(/\bGpt\b/gu, "GPT")
    .replace(/\bAi\b/gu, "AI");
};

const providerFromModelId = (modelId: string): string => {
  const withoutPrefix = modelId.includes(":") ? modelId.split(":", 2)[1] ?? modelId : modelId;
  const provider = withoutPrefix.includes("/") ? withoutPrefix.split("/", 1)[0] ?? withoutPrefix : "Trask web research";
  return provider
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (char) => char.toUpperCase())
    .replace(/\bAi\b/gu, "AI")
    .replace(/^Openrouter$/u, "OpenRouter");
};

const normalizeWebResearchModelId = (modelId: string): string => {
  const trimmed = modelId.trim();
  if (!trimmed) return "";
  if (trimmed.includes(":")) return trimmed;
  return trimmed.startsWith("openrouter/") ? `openrouter:${trimmed}` : `litellm:${trimmed}`;
};

const parseModelList = (stdout: string): HeadlessWebResearchModelOption[] => {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const models: HeadlessWebResearchModelOption[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "string") continue;
    const id = normalizeWebResearchModelId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      label: labelFromModelId(id),
      provider: providerFromModelId(id),
    });
  }
  return models;
};

export const listHeadlessWebResearchModels = async (
  config: WebResearchRuntimeConfig,
): Promise<HeadlessWebResearchModelOption[]> => {
  const repoRoot = config.repoRoot?.trim() || findRepoRoot(process.cwd());
  const python = config.pythonExecutable?.trim() || "python";
  const script = [
    "import json, sys",
    "from pathlib import Path",
    "root = Path(sys.argv[1]).resolve()",
    "fallbacks = root / 'vendor' / 'llm_fallbacks' / 'src'",
    "sys.path.insert(0, str(fallbacks))",
    "try:",
    "    from llm_fallbacks.config import FREE_CHAT_MODELS",
    "    models = [name for name, _ in FREE_CHAT_MODELS]",
    "except Exception:",
    "    from llm_fallbacks import filter_models",
    "    models = list(filter_models(model_type='chat', free_only=True))",
    "print(json.dumps(models[:60]))",
  ].join("\n");

  const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolvePromise, rejectPromise) => {
      const child = spawn(python, ["-c", script, repoRoot], {
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          PYTHONIOENCODING: "utf-8",
          PYTHONUTF8: "1",
        },
      });
      const chunksOut: Buffer[] = [];
      const chunksErr: Buffer[] = [];
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGTERM");
        rejectPromise(new Error("Trask web research model list timed out"));
      }, Math.min(config.timeoutMs, 15_000));
      child.stdout?.on("data", (chunk: Buffer | string) => chunksOut.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      child.stderr?.on("data", (chunk: Buffer | string) => chunksErr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rejectPromise(error);
      });
      child.on("close", (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise({
          stdout: Buffer.concat(chunksOut).toString("utf8").trim(),
          stderr: Buffer.concat(chunksErr).toString("utf8").trim(),
          code: exitCode,
        });
      });
    },
  );

  if (code !== 0) {
    throw new Error(`Trask web research model list exited ${code ?? "unknown"}: ${stderr || stdout || "no output"}`);
  }

  return parseModelList(stdout);
};

/** @deprecated Use listHeadlessWebResearchModels */
export const listHeadlessGptResearcherModels = listHeadlessWebResearchModels;

export const probeHeadlessWebResearchDryRun = async (config: WebResearchRuntimeConfig): Promise<boolean> => {
  const repoRoot = config.repoRoot?.trim() || findRepoRoot(process.cwd());
  const script = (config.headlessScriptPath?.trim() || defaultScriptPath(repoRoot)).trim();
  if (!existsSync(script)) {
    return false;
  }

  const python = config.pythonExecutable?.trim() || "python";
  const { code } = await new Promise<{ code: number | null }>((resolvePromise, rejectPromise) => {
    const child = spawn(python, [script, "--dry-run"], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      rejectPromise(new Error("dry-run probe timed out"));
    }, 15_000);
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code: 1 });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code: exitCode });
    });
  });

  return code === 0;
};
