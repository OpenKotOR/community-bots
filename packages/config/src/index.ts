import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

function findDotEnv(): string | undefined {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, ".env");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const dotEnvPath = findDotEnv();

if (dotEnvPath) {
  loadDotEnv({ path: dotEnvPath });
} else {
  loadDotEnv();
}

const defaultChatModel = "gpt-5.4-mini";
const defaultEmbeddingModel = "text-embedding-3-large";

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
  openAiApiKey: string | undefined;
  firecrawlApiKey: string | undefined;
  chatModel: string;
  embeddingModel: string;
  databaseUrl: string | undefined;
}

export interface ResearchWizardRuntimeConfig {
  baseUrl: string | undefined;
  apiKey: string | undefined;
  timeoutMs: number;
}

export interface TraskBotConfig {
  discord: DiscordRuntimeConfig;
  ai: SharedAiConfig;
  researchWizard: ResearchWizardRuntimeConfig;
  allowedGuildIds: string[];
  approvedChannelIds: string[];
  chunkDir: string;
}

export interface HkBotConfig {
  discord: DiscordRuntimeConfig;
  dataDir: string;
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
  /** Public URL where the pazaak-activity frontend is hosted (for the "Launch Activity" button link). */
  activityUrl: string;
  /** Public standalone website origin for CORS and OAuth redirect flows. */
  publicWebOrigin: string | undefined;
  /** Per-turn decision window for cross-platform clients. */
  turnTimerSeconds: number;
  /** Grace period before disconnected participants forfeit. */
  disconnectForfeitMs: number;
  /** Matchmaking queue scan cadence. */
  matchmakingTickMs: number;
  /** Enables local synthetic Bearer tokens (dev-user-*) for browser-only testing. */
  allowDevAuth: boolean;
}

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

export const loadSharedAiConfig = (env: NodeJS.ProcessEnv = process.env): SharedAiConfig => {
  return {
    openAiApiKey: readOptionalEnv("OPENAI_API_KEY", env),
    firecrawlApiKey: readOptionalEnv("FIRECRAWL_API_KEY", env),
    chatModel: readOptionalEnv("OPENAI_CHAT_MODEL", env) ?? defaultChatModel,
    embeddingModel: readOptionalEnv("OPENAI_EMBEDDING_MODEL", env) ?? defaultEmbeddingModel,
    databaseUrl: readOptionalEnv("DATABASE_URL", env),
  };
};

export const loadTraskBotConfig = (env: NodeJS.ProcessEnv = process.env): TraskBotConfig => {
  return {
    discord: loadDiscordRuntimeConfig("TRASK", env),
    ai: loadSharedAiConfig(env),
    researchWizard: {
      baseUrl: readOptionalEnv("TRASK_RESEARCHWIZARD_BASE_URL", env),
      apiKey: readOptionalEnv("TRASK_RESEARCHWIZARD_API_KEY", env),
      timeoutMs: integerish.parse(readOptionalEnv("TRASK_RESEARCHWIZARD_TIMEOUT_MS", env) ?? "120000"),
    },
    allowedGuildIds: readListEnv("TRASK_ALLOWED_GUILD_IDS", env),
    approvedChannelIds: readListEnv("TRASK_APPROVED_CHANNEL_IDS", env),
    chunkDir: readOptionalEnv("INGEST_STATE_DIR", env) ?? "data/ingest-worker",
  };
};

export const loadHkBotConfig = (env: NodeJS.ProcessEnv = process.env): HkBotConfig => {
  return {
    discord: loadDiscordRuntimeConfig("HK", env),
    dataDir: readOptionalEnv("HK_DATA_DIR", env) ?? "data/hk-bot",
  };
};

export const loadPazaakBotConfig = (env: NodeJS.ProcessEnv = process.env): PazaakBotConfig => {
  return {
    discord: loadDiscordRuntimeConfig("PAZAAK", env),
    dataDir: readOptionalEnv("PAZAAK_DATA_DIR", env) ?? "data/pazaak-bot",
    startingCredits: integerish.parse(readOptionalEnv("PAZAAK_STARTING_CREDITS", env) ?? "1000"),
    dailyBonusCredits: integerish.parse(readOptionalEnv("PAZAAK_DAILY_BONUS", env) ?? "200"),
    dailyCooldownMs: integerish.parse(readOptionalEnv("PAZAAK_DAILY_COOLDOWN_MS", env) ?? "86400000"),
    turnTimeoutMs: integerish.parse(readOptionalEnv("PAZAAK_TURN_TIMEOUT_MS", env) ?? "300000"),
    apiPort: integerish.parse(readOptionalEnv("PAZAAK_API_PORT", env) ?? "4001"),
    activityUrl: readOptionalEnv("PAZAAK_ACTIVITY_URL", env) ?? "http://localhost:5173",
    publicWebOrigin: readOptionalEnv("PAZAAK_PUBLIC_WEB_ORIGIN", env),
    turnTimerSeconds: integerish.parse(readOptionalEnv("PAZAAK_TURN_TIMER_SECONDS", env) ?? "45"),
    disconnectForfeitMs: integerish.parse(readOptionalEnv("PAZAAK_DISCONNECT_FORFEIT_MS", env) ?? "30000"),
    matchmakingTickMs: integerish.parse(readOptionalEnv("PAZAAK_MATCHMAKING_TICK_MS", env) ?? "5000"),
    allowDevAuth: readBooleanEnv("PAZAAK_ALLOW_DEV_AUTH", env) ?? false,
  };
};

export const loadIngestWorkerConfig = (env: NodeJS.ProcessEnv = process.env): IngestWorkerConfig => {
  return {
    ai: loadSharedAiConfig(env),
    stateDir: readOptionalEnv("INGEST_STATE_DIR", env) ?? "data/ingest-worker",
  };
};