import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { ResearchWizardRuntimeConfig } from "@openkotor/config";

export interface HeadlessAiResearchWizardResult {
  readonly report: string;
  readonly research_information?: {
    readonly source_urls?: readonly string[] | null;
    readonly visited_urls?: readonly string[] | null;
  };
}

export interface HeadlessAiResearchWizardModelOption {
  readonly id: string;
  readonly label: string;
  readonly provider: string;
  readonly recommended?: boolean;
}

/** stdin payload for `vendor/ai-researchwizard/trask_headless_research.py`. */
export interface HeadlessAiResearchWizardRequestPayload {
  readonly query: string;
  readonly custom_prompt?: string;
  readonly source_urls?: readonly string[];
  readonly query_domains?: readonly string[];
  readonly model?: string;
  readonly report_type?: string;
  readonly report_source?: string;
}

const spawnHeadless = (
  python: string,
  script: string,
  cwd: string,
  payload: HeadlessAiResearchWizardRequestPayload,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; code: number | null }> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(python, [script], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        // Ensure Python subprocess outputs UTF-8 on all platforms (fixes charmap errors on Windows).
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
      rejectPromise(new Error(`ai-researchwizard headless runner timed out after ${timeoutMs}ms`));
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

export const runHeadlessGptResearcher = async (
  config: ResearchWizardRuntimeConfig,
  payload: HeadlessAiResearchWizardRequestPayload,
): Promise<HeadlessAiResearchWizardResult> => {
  const root = config.gptResearcherRoot?.trim();

  if (!root) {
    throw new Error(
      "ai-researchwizard root could not be resolved. Clone or vendor ai-researchwizard under <repo>/vendor/ai-researchwizard (with gpt_researcher/), or set TRASK_GPT_RESEARCHER_ROOT.",
    );
  }

  const script = (config.headlessScriptPath?.trim() || join(root, "trask_headless_research.py")).trim();

  if (!existsSync(script)) {
    throw new Error(`ai-researchwizard headless script not found: ${script}`);
  }

  const python = config.pythonExecutable?.trim() || "python";
  const runCwd = process.cwd();

  const { stdout, stderr, code } = await spawnHeadless(python, script, runCwd, payload, config.timeoutMs);

  if (code !== 0) {
    throw new Error(`ai-researchwizard headless runner exited ${code ?? "unknown"}: ${stderr || stdout || "no output"}`);
  }

  try {
    const parsed = JSON.parse(stdout) as HeadlessAiResearchWizardResult;

    if (typeof parsed.report !== "string" || !parsed.report.trim()) {
      throw new Error("Headless runner returned empty report.");
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`ai-researchwizard headless runner returned invalid JSON: ${stdout.slice(0, 400)}`);
    }

    throw error;
  }
};

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
  const provider = withoutPrefix.includes("/") ? withoutPrefix.split("/", 1)[0] ?? withoutPrefix : "ResearchWizard";
  return provider
    .replace(/[-_]+/gu, " ")
    .replace(/\b\w/gu, (char) => char.toUpperCase())
    .replace(/\bAi\b/gu, "AI")
    .replace(/^Openrouter$/u, "OpenRouter");
};

const normalizeResearchWizardModelId = (modelId: string): string => {
  const trimmed = modelId.trim();
  if (!trimmed) return "";
  if (trimmed.includes(":")) return trimmed;
  return trimmed.startsWith("openrouter/") ? `openrouter:${trimmed}` : `litellm:${trimmed}`;
};

const parseModelList = (stdout: string): HeadlessAiResearchWizardModelOption[] => {
  const parsed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const models: HeadlessAiResearchWizardModelOption[] = [];
  for (const raw of parsed) {
    if (typeof raw !== "string") continue;
    const id = normalizeResearchWizardModelId(raw);
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

export const listHeadlessGptResearcherModels = async (
  config: ResearchWizardRuntimeConfig,
): Promise<HeadlessAiResearchWizardModelOption[]> => {
  const root = config.gptResearcherRoot?.trim();
  if (!root) return [];

  const python = config.pythonExecutable?.trim() || "python";
  const script = [
    "import json, sys",
    "from pathlib import Path",
    "root = Path(sys.argv[1]).resolve()",
    "fallbacks = root.parent / 'llm_fallbacks' / 'src'",
    "sys.path.insert(0, str(fallbacks))",
    "from llm_fallbacks import get_fallback_list",
    "print(json.dumps(list(get_fallback_list('chat'))[:60]))",
  ].join("; ");

  const { stdout, stderr, code } = await new Promise<{ stdout: string; stderr: string; code: number | null }>(
    (resolvePromise, rejectPromise) => {
      const child = spawn(python, ["-c", script, root], {
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
        rejectPromise(new Error("ai-researchwizard model list timed out"));
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
    throw new Error(`ai-researchwizard model list exited ${code ?? "unknown"}: ${stderr || stdout || "no output"}`);
  }

  return parseModelList(stdout);
};