import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  deepMergePolicy,
  loadPazaakOpsPolicy,
  type PazaakOpsPolicy,
} from "@openkotor/pazaak-policy";

export type { PazaakOpsPolicy } from "@openkotor/pazaak-policy";
import { loadPolicyFromFile } from "@openkotor/pazaak-policy/file-loader";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

function findRepoEnvDir(startDir: string = process.cwd()): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, ".env")) || existsSync(join(dir, ".env.local"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const envDir = findRepoEnvDir();
if (envDir) {
  const dotEnvPath = join(envDir, ".env");
  const dotEnvLocalPath = join(envDir, ".env.local");
  if (existsSync(dotEnvPath)) {
    loadDotEnv({ path: dotEnvPath });
  } else {
    loadDotEnv();
  }
  if (existsSync(dotEnvLocalPath)) {
    loadDotEnv({ path: dotEnvLocalPath, override: true });
  }
} else {
  loadDotEnv();
}

const defaultChatModel = "gpt-5.4-mini";
const defaultEmbeddingModel = "text-embedding-3-large";
const openRouterApiBase = "https://openrouter.ai/api/v1";
/** Direct OpenRouter API model ids (not LiteLLM `openrouter/...` prefixes). */
const freeDefaultOpenRouterChatModel = "openrouter/free";
const paidOpenRouterChatModel = "openrouter/auto";
const paidDirectChatModel = "gpt-4o-mini";
const defaultFreeModelFallbacks = [
  "meta-llama/llama-3.3-70b-instruct:free",
  paidOpenRouterChatModel,
] as const;

/** Providers in free_models_ids.txt that need non-OpenRouter credentials — skip for direct OR API. */
const NON_OPENROUTER_FREE_PREFIXES = [
  "chatgpt/",
  "github_copilot/",
  "gemini/",
  "dashscope/",
  "volcengine/",
  "lemonade/",
  "anthropic.",
  "baidu/",
  "kimi",
  "glm-",
] as const;

const resolveRepoRoot = (startDir: string = process.cwd()): string | undefined => {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(join(dir, "vendor", "llm_fallbacks", "configs", "free_models_ids.txt"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
};

/** Ordered OpenRouter-routable `:free` models from vendored bolabaden/llm_fallbacks. */
const loadVendorOpenRouterFreeFallbacks = (maxModels = 8): readonly string[] => {
  const root = resolveRepoRoot();
  if (!root) return [...defaultFreeModelFallbacks];

  const listPath = join(root, "vendor", "llm_fallbacks", "configs", "free_models_ids.txt");
  let raw: string;
  try {
    raw = readFileSync(listPath, "utf8");
  } catch {
    return [...defaultFreeModelFallbacks];
  }

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const line of raw.split("\n")) {
    const id = line.trim();
    if (!id || seen.has(id)) continue;
    if (id === freeDefaultOpenRouterChatModel) continue;
    const lower = id.toLowerCase();
    if (NON_OPENROUTER_FREE_PREFIXES.some((prefix) => lower.startsWith(prefix))) continue;
    const openRouterRoutable =
      lower.startsWith("openrouter/") || lower.includes(":free") || lower === "openrouter/auto";
    if (!openRouterRoutable) continue;
    seen.add(id);
    ordered.push(id);
    if (ordered.length >= maxModels) break;
  }

  if (ordered.length === 0) return [...defaultFreeModelFallbacks];
  if (!ordered.includes(paidOpenRouterChatModel)) {
    ordered.push(paidOpenRouterChatModel);
  }
  return ordered;
};
/** Matches `general_settings.master_key` in `infra/trask-litellm/litellm_config.yaml`. */
const proxyPlaceholderApiKey = "sk-local";

type TraskLlmProfile = "free" | "paid";
const defaultPazaakWorldUrl = "https://openkotor.github.io/community-bots/pazaakworld";

const integerish = z.coerce.number().int().nonnegative();

const readRequiredEnv = (name: string, env: NodeJS.ProcessEnv = process.env): string => {
  const value = env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable ${name}.`);
  }

  return value;
};

const readOptionalEnv = (name: string, env: NodeJS.ProcessEnv = process.env): string | undefined => {
  const value = env[name]?.trim();
  return value ? value : undefined;
};

const readBooleanEnv = (name: string, env: NodeJS.ProcessEnv = process.env): boolean | undefined => {
  const value = readOptionalEnv(name, env);
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
  throw new Error(`Invalid boolean value for environment variable ${name}: ${value}`);
};

/** Holocron browser sessions: anonymous OK when no `TRASK_WEB_API_KEY` unless explicitly disabled. */
const resolveTraskWebAllowAnonymous = (env: NodeJS.ProcessEnv): boolean => {
  const explicit = readBooleanEnv("TRASK_WEB_ALLOW_ANONYMOUS", env);
  if (explicit !== undefined) {
    return explicit;
  }
  return !Boolean(readOptionalEnv("TRASK_WEB_API_KEY", env)?.trim());
};

const readListEnv = (name: string, env: NodeJS.ProcessEnv = process.env): string[] => {
  const value = readOptionalEnv(name, env);

  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export interface DiscordRuntimeConfig {
  appId: string;
  clientSecret: string | undefined;
  publicKey: string;
  botToken: string;
  guildId: string | undefined;
}

export interface SharedAiConfig {
  /** OpenAI key, or OpenRouter key when using an OpenAI-compatible base URL. */
  openAiApiKey: string | undefined;
  /** When set, the OpenAI SDK talks to this host (e.g. `https://openrouter.ai/api/v1`). */
  openAiBaseUrl: string | undefined;
  /** Extra headers for providers like OpenRouter (`HTTP-Referer`, `X-Title`). */
  openAiDefaultHeaders: Record<string, string> | undefined;
  firecrawlApiKey: string | undefined;
  chatModel: string;
  /** Tried in order after `chatModel` when rewrite completions fail. */
  chatModelFallbacks: readonly string[];
  embeddingModel: string;
  databaseUrl: string | undefined;
}

export type ResearchComposeMode = "grounded" | "rewrite";

export interface ResearchWizardRuntimeConfig {
  /** Base URL for `infra/trask-indexer` retrieve API (POST /retrieve). */
  indexerBaseUrl: string;
  /** Python interpreter for `scripts/trask_web_research.py` (default `python`). */
  pythonExecutable: string;
  /** Optional absolute path to the research runner; default `<repo>/scripts/trask_web_research.py`. */
  researchScriptPath: string | undefined;
  /** Legacy overall budget; subprocess gather uses {@link gatherTimeoutMs}. */
  timeoutMs: number;
  /** Python `trask_web_research.py` subprocess wall clock (Holocron ~2m default). */
  gatherTimeoutMs: number;
  /** Node rewrite / LLM compose ceiling per query. */
  composeTimeoutMs: number;
  /** When true (default), use question-last grounded compose when passages exist. */
  groundedComposeEnabled: boolean;
  /** `rewrite` enables legacy digest rewrite; default `grounded`. */
  composeMode: ResearchComposeMode;
  /** Kill Discord index sync subprocess after this many ms (0 = no timeout). */
  discordSyncTimeoutMs: number;
}

const findMonorepoRoot = (startDir: string, maxHops = 24): string | undefined => {
  let dir = resolve(startDir);
  for (let hop = 0; hop < maxHops; hop++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) && existsSync(join(dir, "scripts", "trask_web_research.py"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return undefined;
    }
    dir = parent;
  }
  return undefined;
};

const resolveMonorepoRoot = (env: NodeJS.ProcessEnv): string => {
  const explicit = readOptionalEnv("TRASK_REPO_ROOT", env)?.trim();
  if (explicit) {
    return resolve(explicit);
  }

  const fromCwd = findMonorepoRoot(process.cwd());
  if (fromCwd) {
    return fromCwd;
  }

  const configModuleDir = dirname(fileURLToPath(import.meta.url));
  return findMonorepoRoot(configModuleDir) ?? resolve(configModuleDir, "..", "..", "..");
};

/**
 * Prefer the monorepo bootstrap venv (`scripts/bootstrap_trask_research.sh`) when
 * `TRASK_WEB_RESEARCH_PYTHON` is unset.
 */
const resolveTraskResearchPythonExecutable = (repoRoot: string, env: NodeJS.ProcessEnv): string => {
  const explicit =
    readOptionalEnv("TRASK_WEB_RESEARCH_PYTHON", env)?.trim() ??
    readOptionalEnv("TRASK_RESEARCH_PYTHON", env)?.trim();
  if (explicit) {
    return explicit;
  }

  const winPy = join(repoRoot, ".venv-trask-research", "Scripts", "python.exe");
  const unixPy = join(repoRoot, ".venv-trask-research", "bin", "python");

  if (process.platform === "win32" && existsSync(winPy)) {
    return winPy;
  }

  if (existsSync(unixPy)) {
    return unixPy;
  }

  return "python";
};

export const loadResearchWizardRuntimeConfig = (env: NodeJS.ProcessEnv = process.env): ResearchWizardRuntimeConfig => {
  const repoRoot = resolveMonorepoRoot(env);
  const scriptRaw =
    readOptionalEnv("TRASK_WEB_RESEARCH_SCRIPT", env) ?? readOptionalEnv("TRASK_RESEARCH_SCRIPT", env);
  const timeoutRaw =
    readOptionalEnv("TRASK_RESEARCH_TIMEOUT_MS", env) ??
    readOptionalEnv("TRASK_WEB_RESEARCH_TIMEOUT_MS", env) ??
    readOptionalEnv("TRASK_RESEARCHWIZARD_TIMEOUT_MS", env) ??
    "900000";
  const gatherTimeoutRaw =
    readOptionalEnv("TRASK_RESEARCH_GATHER_MS", env) ??
    readOptionalEnv("TRASK_WEB_RESEARCH_GATHER_MS", env) ??
    "120000";
  const composeTimeoutRaw =
    readOptionalEnv("TRASK_RESEARCH_COMPOSE_MS", env) ??
    readOptionalEnv("TRASK_WEB_RESEARCH_COMPOSE_MS", env) ??
    "60000";

  const composeModeRaw = readOptionalEnv("TRASK_RESEARCH_COMPOSE_MODE", env)?.trim().toLowerCase();
  const composeMode: ResearchComposeMode = composeModeRaw === "rewrite" ? "rewrite" : "grounded";

  const groundedRaw = readOptionalEnv("TRASK_GROUNDED_COMPOSE", env)?.trim().toLowerCase();
  let groundedComposeEnabled = composeMode === "grounded";
  if (groundedRaw === "0" || groundedRaw === "false" || groundedRaw === "no" || groundedRaw === "off") {
    groundedComposeEnabled = false;
  }

  const syncTimeoutRaw = readOptionalEnv("TRASK_DISCORD_SYNC_TIMEOUT_MS", env) ?? "600000";

  return {
    indexerBaseUrl: (readOptionalEnv("TRASK_INDEXER_BASE_URL", env) ?? "http://127.0.0.1:8787").trim(),
    pythonExecutable: resolveTraskResearchPythonExecutable(repoRoot, env),
    researchScriptPath: scriptRaw ? resolve(scriptRaw.trim()) : undefined,
    timeoutMs: integerish.parse(timeoutRaw),
    gatherTimeoutMs: integerish.parse(gatherTimeoutRaw),
    composeTimeoutMs: integerish.parse(composeTimeoutRaw),
    groundedComposeEnabled,
    composeMode,
    discordSyncTimeoutMs: integerish.parse(syncTimeoutRaw),
  };
};

/** Legacy headless runner config used by `WebResearchClient` (pazaak embedded Trask). */
export interface WebResearchRuntimeConfig {
  repoRoot: string;
  pythonExecutable: string;
  headlessScriptPath: string | undefined;
  backendUrl: string | undefined;
  timeoutMs: number;
}

export const loadWebResearchRuntimeConfig = (env: NodeJS.ProcessEnv = process.env): WebResearchRuntimeConfig => {
  const wizard = loadResearchWizardRuntimeConfig(env);
  const repoRoot = resolveMonorepoRoot(env);
  const scriptRaw =
    readOptionalEnv("TRASK_WEB_RESEARCH_SCRIPT", env)?.trim()
    ?? readOptionalEnv("TRASK_GPT_RESEARCHER_SCRIPT", env)?.trim();
  const backendUrl = readOptionalEnv("TRASK_RESEARCH_BACKEND_URL", env)?.trim() || undefined;
  return {
    repoRoot,
    pythonExecutable: wizard.pythonExecutable,
    headlessScriptPath: wizard.researchScriptPath ?? (scriptRaw ? resolve(scriptRaw) : undefined),
    backendUrl,
    timeoutMs: wizard.timeoutMs,
  };
};

export interface TraskProactiveConfig {
  /** When true, reads channel messages (privileged intents) and may reply without `/ask`. */
  enabled: boolean;
  /**
   * Channel IDs where proactive replies are allowed. When empty, falls back to `approvedChannelIds`.
   * Proactive mode requires at least one channel after resolution (otherwise it stays off).
   */
  channelIds: string[];
  debounceMs: number;
  userCooldownMs: number;
  /** Skip auto-reply if another user's message after the trigger reaches at least this length. */
  competingReplyMinLength: number;
  classifierModel: string;
  classifierMinConfidence: number;
  /** Minimum cosine similarity between embeddings of (question|answer) vs research report. */
  similarityThreshold: number;
  minMessageLength: number;
  maxMessageLength: number;
  maxReplyChars: number;
}

export interface TraskWelcomeConfig {
  /** Channel ID where Trask posts a one-shot welcome for joining members. */
  channelId: string;
  /** Welcome template supporting $mention, $user, and $server placeholders. */
  message: string;
}

export interface TraskBotConfig {
  discord: DiscordRuntimeConfig;
  ai: SharedAiConfig;
  researchWizard: ResearchWizardRuntimeConfig;
  allowedGuildIds: string[];
  approvedChannelIds: string[];
  /** Channel IDs excluded from automatic Discord indexing (`TRASK_DISCORD_CHANNEL_BLACKLIST`). */
  discordChannelBlacklist: string[];
  /** When > 0, Trask bot runs `scripts/trask_discord_sync.py` on this interval (ms). */
  discordSyncIntervalMs: number;
  /** Guild IDs where slash commands are registered (comma list in `TRASK_SLASH_GUILD_IDS`). */
  slashCommandGuildIds: string[];
  chunkDir: string;
  /** Directory for `trask-queries.json` (shared with Holocron when using the embedded web UI). */
  queryDataDir: string;
  /**
   * When set, serves `apps/holocron-web/dist` and `/api/trask/*` on this port (same process as the bot).
   * Use Discord OAuth + `TRASK_SESSION_SECRET` so browser sessions map to Discord user ids.
   */
  webPort: number | undefined;
  webSessionSecret: string | undefined;
  /** Full callback URL registered in the Discord app (e.g. `http://127.0.0.1:8787/api/trask/auth/discord/callback`). */
  webOAuthRedirectUri: string | undefined;
  webApiKey: string | undefined;
  webAllowAnonymous: boolean;
  webDefaultUserId: string;
  /**
   * Public Holocron base URL for Discord embed links (e.g. `https://holocron.example.com` or GitHub Pages origin).
   * Each `/ask` reply appends `?thread=<uuid>`.
   */
  holocronPublicUrl: string | undefined;
  proactive: TraskProactiveConfig;
  welcome?: TraskWelcomeConfig;
}

export interface HkBotConfig {
  discord: DiscordRuntimeConfig;
  ai: SharedAiConfig;
  dataDir: string;
  llm: {
    enabled: boolean;
    timeoutMs: number;
    maxReplyChars: number;
  };
}

export interface PazaakBotConfig {
  discord: DiscordRuntimeConfig;
  dataDir: string;
  startingCredits: number;
  dailyBonusCredits: number;
  dailyCooldownMs: number;
  turnTimeoutMs: number;
  /** Port for the embedded HTTP/WS API used by Activities and the browser UI. */
  apiPort: number;
  /** Public URL where the pazaak-world frontend is hosted (for the "Launch Activity" button link). */
  activityUrl: string;
  /** Public standalone website URL for CORS and OAuth redirect flows. */
  publicWebOrigin: string | undefined;
  /** Per-turn decision window for cross-platform clients. */
  turnTimerSeconds: number;
  /** Grace period before disconnected participants forfeit. */
  disconnectForfeitMs: number;
  /** Matchmaking queue scan cadence. */
  matchmakingTickMs: number;
  /** Enables local synthetic Bearer tokens (dev-user-*) for browser-only testing. */
  allowDevAuth: boolean;
  /** Unified YAML/JSON/env ops policy (`PAZAAK_POLICY_PATH`, `PAZAAK_POLICY_JSON`, `PAZAAK_POLICY__*` ). */
  opsPolicy: PazaakOpsPolicy;
}

/** Resolve ops policy for Node services (declarative file + env layers + legacy `PAZAAK_*` timers when set). */
export const loadPazaakOpsPolicyForNode = (env: NodeJS.ProcessEnv = process.env): PazaakOpsPolicy => {
  const path = readOptionalEnv("PAZAAK_POLICY_PATH", env)?.trim();
  const base = path && existsSync(path) ? loadPolicyFromFile(path) : undefined;
  let policy = loadPazaakOpsPolicy(env, base ? { basePolicy: base } : {});

  const legacyTimers: Record<string, number> = {};
  const tt = readOptionalEnv("PAZAAK_TURN_TIMER_SECONDS", env);
  if (tt) legacyTimers.turnTimerSeconds = integerish.parse(tt);
  const tm = readOptionalEnv("PAZAAK_TURN_TIMEOUT_MS", env);
  if (tm) legacyTimers.turnTimeoutMs = integerish.parse(tm);
  const df = readOptionalEnv("PAZAAK_DISCONNECT_FORFEIT_MS", env);
  if (df) legacyTimers.disconnectForfeitMs = integerish.parse(df);
  if (Object.keys(legacyTimers).length > 0) {
    policy = deepMergePolicy(policy, { timers: legacyTimers });
  }
  const mt = readOptionalEnv("PAZAAK_MATCHMAKING_TICK_MS", env);
  if (mt) {
    policy = deepMergePolicy(policy, { matchmaking: { tickMs: integerish.parse(mt) } });
  }
  return policy;
};

export interface IngestWorkerConfig {
  ai: SharedAiConfig;
  stateDir: string;
}

export const loadDiscordRuntimeConfig = (
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): DiscordRuntimeConfig => {
  return {
    appId: readRequiredEnv(`${prefix}_DISCORD_APP_ID`, env),
    clientSecret: readOptionalEnv(`${prefix}_DISCORD_CLIENT_SECRET`, env),
    publicKey: readRequiredEnv(`${prefix}_DISCORD_PUBLIC_KEY`, env),
    botToken: readRequiredEnv(`${prefix}_DISCORD_BOT_TOKEN`, env),
    guildId: readOptionalEnv(`${prefix}_DISCORD_GUILD_ID`, env) ?? readOptionalEnv("DISCORD_TARGET_GUILD_ID", env),
  };
};

const buildOpenAiProviderHeaders = (env: NodeJS.ProcessEnv): Record<string, string> | undefined => {
  const referer = readOptionalEnv("OPENROUTER_HTTP_REFERER", env);
  const title = readOptionalEnv("OPENROUTER_APP_TITLE", env);
  const headers: Record<string, string> = {};
  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;
  return Object.keys(headers).length > 0 ? headers : undefined;
};

const stripTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end -= 1;
  return value.slice(0, end);
};

const normalizeOpenAiCompatibleBaseUrl = (raw: string): string => {
  const trimmed = stripTrailingSlashes(raw.trim());
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
};

const resolveTraskLlmProfile = (env: NodeJS.ProcessEnv): TraskLlmProfile => {
  const raw = readOptionalEnv("TRASK_LLM_PROFILE", env)?.toLowerCase();
  return raw === "paid" ? "paid" : "free";
};

/** LiteLLM (:4000) or OpenCode LLM proxy — OpenAI-compatible; fallbacks live in the proxy config. */
const resolveLlmProxyBaseUrl = (env: NodeJS.ProcessEnv): string | undefined => {
  const hit =
    readOptionalEnv("TRASK_LLM_BASE_URL", env) ??
    readOptionalEnv("LITELLM_PROXY_URL", env) ??
    readOptionalEnv("OPENCODE_LLM_PROXY_URL", env);
  return hit ? normalizeOpenAiCompatibleBaseUrl(hit) : undefined;
};

const resolveOpenAiApiKey = (env: NodeJS.ProcessEnv, proxyBaseUrl: string | undefined): string | undefined => {
  const direct =
    readOptionalEnv("OPENAI_API_KEY", env) ??
    readOptionalEnv("OPENROUTER_API_KEY", env) ??
    readOptionalEnv("GROQ_API_KEY", env);
  if (direct) return direct;
  if (proxyBaseUrl) {
    return (
      readOptionalEnv("LITELLM_API_KEY", env) ??
      readOptionalEnv("OPENCODE_LLM_PROXY_TOKEN", env) ??
      readOptionalEnv("LITELLM_MASTER_KEY", env) ??
      proxyPlaceholderApiKey
    );
  }
  return undefined;
};

const resolveDefaultChatModel = (
  env: NodeJS.ProcessEnv,
  profile: TraskLlmProfile,
  proxyBaseUrl: string | undefined,
  openRouterKey: string | undefined,
  openAiKey: string | undefined,
  openAiBaseUrl: string | undefined,
): string => {
  const explicit = readOptionalEnv("OPENAI_CHAT_MODEL", env) ?? readOptionalEnv("TRASK_LLM_MODEL", env);
  if (explicit) return explicit;

  if (proxyBaseUrl) {
    return profile === "paid" ? "trask-research-paid-only" : "trask-research";
  }

  const usesOpenRouter =
    Boolean(openRouterKey) || openAiBaseUrl?.includes("openrouter.ai") === true;
  if (usesOpenRouter) {
    return profile === "paid" ? paidOpenRouterChatModel : freeDefaultOpenRouterChatModel;
  }

  if (profile === "paid" || openAiKey) {
    return paidDirectChatModel;
  }

  return defaultChatModel;
};

const resolveDefaultChatModelFallbacks = (
  env: NodeJS.ProcessEnv,
  profile: TraskLlmProfile,
  proxyBaseUrl: string | undefined,
  openRouterKey: string | undefined,
): readonly string[] => {
  const explicit = readListEnv("TRASK_REWRITE_MODEL_FALLBACKS", env);
  if (explicit.length > 0) return explicit;
  if (profile !== "free") return [];
  if (proxyBaseUrl) return [];
  if (openRouterKey) return loadVendorOpenRouterFreeFallbacks();
  return [];
};

export const loadSharedAiConfig = (env: NodeJS.ProcessEnv = process.env): SharedAiConfig => {
  const profile = resolveTraskLlmProfile(env);
  const proxyBaseUrl = resolveLlmProxyBaseUrl(env);
  const openRouterKey = readOptionalEnv("OPENROUTER_API_KEY", env);
  const openAiKey = readOptionalEnv("OPENAI_API_KEY", env);
  const explicitBaseUrl = readOptionalEnv("OPENAI_BASE_URL", env);

  let openAiBaseUrl = explicitBaseUrl
    ? normalizeOpenAiCompatibleBaseUrl(explicitBaseUrl)
    : proxyBaseUrl;
  if (!openAiBaseUrl && openRouterKey && !openAiKey) {
    openAiBaseUrl = openRouterApiBase;
  }

  const openAiApiKey = resolveOpenAiApiKey(env, proxyBaseUrl);
  const chatModel = resolveDefaultChatModel(env, profile, proxyBaseUrl, openRouterKey, openAiKey, openAiBaseUrl);
  const chatModelFallbacks = resolveDefaultChatModelFallbacks(env, profile, proxyBaseUrl, openRouterKey);

  return {
    openAiApiKey,
    openAiBaseUrl,
    openAiDefaultHeaders: buildOpenAiProviderHeaders(env),
    firecrawlApiKey: readOptionalEnv("FIRECRAWL_API_KEY", env),
    chatModel,
    chatModelFallbacks,
    embeddingModel: readOptionalEnv("OPENAI_EMBEDDING_MODEL", env) ?? defaultEmbeddingModel,
    databaseUrl: readOptionalEnv("DATABASE_URL", env),
  };
};

export const loadTraskBotConfig = (env: NodeJS.ProcessEnv = process.env): TraskBotConfig => {
  const proactiveChannelIds = readListEnv("TRASK_PROACTIVE_CHANNEL_IDS", env);
  const approvedChannelIds = readListEnv("TRASK_APPROVED_CHANNEL_IDS", env);
  const welcomeChannelId = readOptionalEnv("TRASK_WELCOME_CHANNEL_ID", env);
  const welcomeMessage = readOptionalEnv("TRASK_WELCOME_MESSAGE", env);
  const welcome = welcomeChannelId && welcomeMessage
    ? {
        channelId: welcomeChannelId,
        message: welcomeMessage,
      }
    : undefined;

  return {
    discord: loadDiscordRuntimeConfig("TRASK", env),
    ai: loadSharedAiConfig(env),
    researchWizard: loadResearchWizardRuntimeConfig(env),
    allowedGuildIds: readListEnv("TRASK_ALLOWED_GUILD_IDS", env),
    approvedChannelIds,
    discordChannelBlacklist: readListEnv("TRASK_DISCORD_CHANNEL_BLACKLIST", env),
    discordSyncIntervalMs: integerish.parse(readOptionalEnv("TRASK_DISCORD_SYNC_INTERVAL_MS", env) ?? "0"),
    slashCommandGuildIds: readListEnv("TRASK_SLASH_GUILD_IDS", env),
    chunkDir: readOptionalEnv("INGEST_STATE_DIR", env) ?? "data/ingest-worker",
    queryDataDir: readOptionalEnv("TRASK_QUERY_DATA_DIR", env) ?? "data/trask-bot",
    webPort: readOptionalEnv("TRASK_WEB_PORT", env)
      ? integerish.parse(readOptionalEnv("TRASK_WEB_PORT", env)!)
      : undefined,
    webSessionSecret: readOptionalEnv("TRASK_SESSION_SECRET", env),
    webOAuthRedirectUri: readOptionalEnv("TRASK_WEB_OAUTH_REDIRECT_URI", env),
    webApiKey: readOptionalEnv("TRASK_WEB_API_KEY", env),
    webAllowAnonymous: resolveTraskWebAllowAnonymous(env),
    webDefaultUserId: readOptionalEnv("TRASK_WEB_DEFAULT_USER_ID", env) ?? "qa-webui",
    holocronPublicUrl: readOptionalEnv("TRASK_HOLOCRON_PUBLIC_URL", env),
    proactive: {
      enabled: readBooleanEnv("TRASK_PROACTIVE_ENABLED", env) ?? false,
      channelIds: proactiveChannelIds,
      debounceMs: integerish.parse(readOptionalEnv("TRASK_PROACTIVE_DEBOUNCE_MS", env) ?? "25000"),
      userCooldownMs: integerish.parse(readOptionalEnv("TRASK_PROACTIVE_USER_COOLDOWN_MS", env) ?? "120000"),
      competingReplyMinLength: integerish.parse(readOptionalEnv("TRASK_PROACTIVE_COMPETING_MIN_LENGTH", env) ?? "80"),
      classifierModel: readOptionalEnv("TRASK_PROACTIVE_CLASSIFIER_MODEL", env) ?? "gpt-4o-mini",
      classifierMinConfidence: z.coerce.number().min(0).max(1).parse(readOptionalEnv("TRASK_PROACTIVE_CLASSIFIER_MIN_CONFIDENCE", env) ?? "0.55"),
      similarityThreshold: z.coerce.number().min(0).max(1).parse(readOptionalEnv("TRASK_PROACTIVE_SIMILARITY_THRESHOLD", env) ?? "0.62"),
      minMessageLength: integerish.parse(readOptionalEnv("TRASK_PROACTIVE_MIN_MESSAGE_LENGTH", env) ?? "12"),
      maxMessageLength: integerish.parse(readOptionalEnv("TRASK_PROACTIVE_MAX_MESSAGE_LENGTH", env) ?? "400"),
      maxReplyChars: integerish.parse(readOptionalEnv("TRASK_PROACTIVE_MAX_REPLY_CHARS", env) ?? "650"),
    },
    ...(welcome ? { welcome } : {}),
  };
};

export const loadHkBotConfig = (env: NodeJS.ProcessEnv = process.env): HkBotConfig => {
  return {
    discord: loadDiscordRuntimeConfig("HK", env),
    ai: loadSharedAiConfig(env),
    dataDir: readOptionalEnv("HK_DATA_DIR", env) ?? "data/hk-bot",
    llm: {
      enabled: readBooleanEnv("HK_LLM_ENABLED", env) ?? false,
      timeoutMs: integerish.parse(readOptionalEnv("HK_LLM_TIMEOUT_MS", env) ?? "6000"),
      maxReplyChars: integerish.parse(readOptionalEnv("HK_LLM_MAX_REPLY_CHARS", env) ?? "420"),
    },
  };
};

export const loadPazaakBotConfig = (env: NodeJS.ProcessEnv = process.env): PazaakBotConfig => {
  const opsPolicy = loadPazaakOpsPolicyForNode(env);
  return {
    discord: loadDiscordRuntimeConfig("PAZAAK", env),
    dataDir: readOptionalEnv("PAZAAK_DATA_DIR", env) ?? "data/pazaak-bot",
    startingCredits: integerish.parse(readOptionalEnv("PAZAAK_STARTING_CREDITS", env) ?? "1000"),
    dailyBonusCredits: integerish.parse(readOptionalEnv("PAZAAK_DAILY_BONUS", env) ?? "200"),
    dailyCooldownMs: integerish.parse(readOptionalEnv("PAZAAK_DAILY_COOLDOWN_MS", env) ?? "86400000"),
    turnTimeoutMs: opsPolicy.timers.turnTimeoutMs,
    apiPort: integerish.parse(readOptionalEnv("PAZAAK_API_PORT", env) ?? "4001"),
    activityUrl: readOptionalEnv("PAZAAK_ACTIVITY_URL", env) ?? defaultPazaakWorldUrl,
    publicWebOrigin: readOptionalEnv("PAZAAK_PUBLIC_WEB_ORIGIN", env) ?? defaultPazaakWorldUrl,
    turnTimerSeconds: opsPolicy.timers.turnTimerSeconds,
    disconnectForfeitMs: opsPolicy.timers.disconnectForfeitMs,
    matchmakingTickMs: opsPolicy.matchmaking.tickMs,
    allowDevAuth: readBooleanEnv("PAZAAK_ALLOW_DEV_AUTH", env) ?? false,
    opsPolicy,
  };
};

export const loadIngestWorkerConfig = (env: NodeJS.ProcessEnv = process.env): IngestWorkerConfig => {
  return {
    ai: loadSharedAiConfig(env),
    stateDir: readOptionalEnv("INGEST_STATE_DIR", env) ?? "data/ingest-worker",
  };
};

export interface TraskHttpServerConfig {
  port: number;
  researchWizard: ResearchWizardRuntimeConfig;
  ai: SharedAiConfig;
  dataDir: string;
  /** When set, require `Authorization: Bearer <key>` or `X-Trask-Api-Key`. */
  webApiKey: string | undefined;
  /** When true and no API key is configured, accept unauthenticated requests scoped to `webDefaultUserId`. */
  webAllowAnonymous: boolean;
  /** User id bucket for anonymous or API-key sessions in `JsonTraskQueryRepository`. */
  webDefaultUserId: string;
  chunkDir: string;
  /** Browser origin for CORS (e.g. Holocron Vite dev server). */
  publicWebOrigin: string | undefined;
}

export const loadTraskHttpServerConfig = (env: NodeJS.ProcessEnv = process.env): TraskHttpServerConfig => {
  return {
    port: integerish.parse(readOptionalEnv("TRASK_HTTP_PORT", env) ?? "4010"),
    researchWizard: loadResearchWizardRuntimeConfig(env),
    ai: loadSharedAiConfig(env),
    dataDir: readOptionalEnv("TRASK_HTTP_DATA_DIR", env) ?? "data/trask-http-server",
    webApiKey: readOptionalEnv("TRASK_WEB_API_KEY", env),
    webAllowAnonymous: resolveTraskWebAllowAnonymous(env),
    webDefaultUserId: readOptionalEnv("TRASK_WEB_DEFAULT_USER_ID", env) ?? "qa-webui",
    chunkDir: readOptionalEnv("INGEST_STATE_DIR", env) ?? "data/ingest-worker",
    publicWebOrigin: readOptionalEnv("TRASK_PUBLIC_WEB_ORIGIN", env),
  };
};
