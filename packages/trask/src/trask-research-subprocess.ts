import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ResearchWizardRuntimeConfig } from "@openkotor/config";

export interface TraskWebResearchPassage {
  readonly quote: string;
  readonly url: string;
  readonly host?: string;
  readonly score?: number;
  readonly sourceId?: string;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly firstMessageId?: string;
}

export interface TraskWebResearchResult {
  readonly report: string;
  readonly passages?: readonly TraskWebResearchPassage[];
  readonly research_information?: {
    readonly source_urls?: readonly string[] | null;
    readonly cited_urls?: readonly string[] | null;
    readonly retrieved_urls?: readonly string[] | null;
    readonly visited_urls?: readonly string[] | null;
    readonly query_domains?: readonly string[] | null;
    readonly allowed_url_prefixes?: readonly string[] | null;
    readonly rejected_source_urls?: readonly string[] | null;
    readonly index_miss?: boolean | null;
  };
}

/** stdin payload for `scripts/trask_web_research.py`. */
export interface TraskWebResearchRequestPayload {
  readonly query: string;
  readonly query_domains?: readonly string[];
  readonly allowed_url_prefixes?: readonly string[];
}

export type TraskResearchLogLevel = "info" | "debug";

export type TraskResearchLogSink = (line: string, level: TraskResearchLogLevel) => void;

let researchLogSink: TraskResearchLogSink | undefined;

/** Optional bridge for trask-bot / trask-http to forward Python stderr into app loggers. */
export const setTraskResearchLogSink = (sink: TraskResearchLogSink | undefined): void => {
  researchLogSink = sink;
};

const traskPackageDir = dirname(fileURLToPath(import.meta.url));
const monorepoRootFromPackage = join(traskPackageDir, "..", "..", "..");

const defaultResearchScript = (): string => join(monorepoRootFromPackage, "scripts", "trask_web_research.py");

const researchLoggingVerbose = (): boolean => {
  const level = process.env.TRASK_RESEARCH_LOG_LEVEL?.trim().toUpperCase();
  return process.env.TRASK_RESEARCH_LOG_VERBOSE === "1" || level === "DEBUG";
};

const forwardResearchStderrLine = (line: string): void => {
  const trimmed = line.trim();
  if (!trimmed) return;

  const level: TraskResearchLogLevel =
    /\bDEBUG\b/.test(trimmed) && researchLoggingVerbose() ? "debug" : "info";
  const prefixed = `[trask-research] ${trimmed}`;

  if (researchLogSink) {
    researchLogSink(prefixed, level);
    return;
  }

  if (level === "debug") {
    console.debug(prefixed);
  } else {
    console.error(prefixed);
  }
};

const attachStderrLineForwarder = (stderr: NodeJS.ReadableStream | null): void => {
  if (!stderr) return;

  let pending = "";
  stderr.on("data", (chunk: Buffer | string) => {
    pending += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      forwardResearchStderrLine(line);
    }
  });
  stderr.on("end", () => {
    if (pending.trim()) {
      forwardResearchStderrLine(pending);
    }
  });
};

const spawnResearchRunner = (
  config: ResearchWizardRuntimeConfig,
  python: string,
  script: string,
  cwd: string,
  payload: TraskWebResearchRequestPayload,
): Promise<{ stdout: string; stderr: string; code: number | null }> => {
  return new Promise((resolvePromise, rejectPromise) => {
    const pythonArgs = researchLoggingVerbose() ? [script, "-v"] : [script];
    const child = spawn(python, pythonArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        TRASK_INDEXER_BASE_URL: config.indexerBaseUrl,
        TRASK_ALLOWED_QUERY_DOMAINS: (payload.query_domains ?? []).join("\n"),
        TRASK_ALLOWED_URL_PREFIXES: (payload.allowed_url_prefixes ?? []).join("\n"),
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
      },
    });

    const chunksOut: Buffer[] = [];
    const chunksErr: Buffer[] = [];
    let settled = false;

    attachStderrLineForwarder(child.stderr);

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
      const gatherMs = config.gatherTimeoutMs;
      rejectPromise(new Error(`Trask web research runner timed out after ${gatherMs}ms (gather)`));
    }, config.gatherTimeoutMs);

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

const resolveScriptPath = (config: ResearchWizardRuntimeConfig): string => {
  const explicit = config.researchScriptPath?.trim();
  if (explicit) {
    return explicit;
  }

  return defaultResearchScript();
};

export const runTraskWebResearch = async (
  config: ResearchWizardRuntimeConfig,
  payload: TraskWebResearchRequestPayload,
): Promise<TraskWebResearchResult> => {
  const script = resolveScriptPath(config);

  if (!existsSync(script)) {
    throw new Error(`Trask web research script not found: ${script}`);
  }

  const python = config.pythonExecutable?.trim() || "python";
  const runCwd = monorepoRootFromPackage;

  const { stdout, stderr, code } = await spawnResearchRunner(config, python, script, runCwd, payload);

  if (code !== 0) {
    throw new Error(`Trask web research runner exited ${code ?? "unknown"}: ${stderr || stdout || "no output"}`);
  }

  try {
    const parsed = JSON.parse(stdout) as TraskWebResearchResult;

    if (typeof parsed.report !== "string" || !parsed.report.trim()) {
      throw new Error("Trask web research returned an empty report.");
    }

    return parsed;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Trask web research returned invalid JSON: ${stdout.slice(0, 400)}`);
    }

    throw error;
  }
};
