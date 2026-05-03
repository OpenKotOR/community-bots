import { existsSync, readFileSync, statSync, watchFile } from "node:fs";

import type { Logger } from "@openkotor/core";

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

const SNOWFLAKE_RE = /^\d{17,20}$/;
const DEFAULT_NEW_MEMBER_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_NEW_ACCOUNT_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const isSnowflake = (value: string): boolean => SNOWFLAKE_RE.test(value);

export interface HkHoneypotConfig {
  channelIds: readonly string[];
  quarantineRoleId: string | undefined;
  deleteTriggerMessage: boolean;
  ignoreMembersOlderThanMs: number;
  ignoreAccountsOlderThanMs: number;
}

export interface HkLabyrinthConfig {
  entryRoleId: string | undefined;
  verifiedRoleIds: readonly string[];
}

export interface HkWelcomeConfig {
  channelId: string;
  message: string;
}

export interface HkGuardConfig {
  enabled: boolean;
  logChannelId: string | undefined;
  trustedRoleIds: readonly string[];
  honeypot: HkHoneypotConfig;
  labyrinth: HkLabyrinthConfig;
  welcome: HkWelcomeConfig | undefined;
  autoroles: readonly string[];
}

interface RawGuardRoot {
  enabled?: JsonValue;
  logChannelId?: JsonValue;
  trustedRoleIds?: JsonValue;
  honeypot?: JsonValue;
  labyrinth?: JsonValue;
  welcome?: JsonValue;
  autoroles?: JsonValue;
}

interface RawHoneypot {
  channelIds?: JsonValue;
  quarantineRoleId?: JsonValue;
  deleteTriggerMessage?: JsonValue;
  ignoreMembersOlderThanMs?: JsonValue;
  ignoreAccountsOlderThanMs?: JsonValue;
}

interface RawLabyrinth {
  entryRoleId?: JsonValue;
  verifiedRoleIds?: JsonValue;
}

interface RawWelcome {
  channelId?: JsonValue;
  message?: JsonValue;
}

const asRecord = (value: JsonValue | undefined): Record<string, JsonValue> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value;
};

const parseOptionalSnowflake = (value: JsonValue | undefined, path: string): string | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || !isSnowflake(value)) {
    throw new Error(`${path} must be a Discord snowflake`);
  }

  return value;
};

const parseSnowflakeList = (value: JsonValue | undefined, path: string): string[] => {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array of Discord snowflakes`);
  }

  const ids: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string" || !isSnowflake(entry)) {
      throw new Error(`${path} must contain only Discord snowflakes`);
    }

    if (!ids.includes(entry)) {
      ids.push(entry);
    }
  }

  return ids;
};

const parseBoolean = (value: JsonValue | undefined, fallback: boolean, path: string): boolean => {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean`);
  }

  return value;
};

const parseNonNegativeNumber = (value: JsonValue | undefined, fallback: number, path: string): number => {
  if (value === undefined || value === null) {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${path} must be a non-negative number`);
  }

  return value;
};

export const parseGuardConfigJson = (text: string): HkGuardConfig => {
  let root: RawGuardRoot;

  try {
    root = JSON.parse(text) as RawGuardRoot;
  } catch {
    throw new Error("hk-guard.json is not valid JSON");
  }

  const honeypotRaw = asRecord(root.honeypot) as RawHoneypot;
  const labyrinthRaw = asRecord(root.labyrinth) as RawLabyrinth;
  const welcomeRaw = root.welcome === undefined ? undefined : (asRecord(root.welcome) as RawWelcome);

  const welcomeChannelId = welcomeRaw ? parseOptionalSnowflake(welcomeRaw.channelId, "welcome.channelId") : undefined;
  const welcomeMessage = welcomeRaw?.message;
  const welcome =
    welcomeChannelId && typeof welcomeMessage === "string" && welcomeMessage.trim()
      ? { channelId: welcomeChannelId, message: welcomeMessage.trim() }
      : undefined;

  return {
    enabled: parseBoolean(root.enabled, false, "enabled"),
    logChannelId: parseOptionalSnowflake(root.logChannelId, "logChannelId"),
    trustedRoleIds: parseSnowflakeList(root.trustedRoleIds, "trustedRoleIds"),
    honeypot: {
      channelIds: parseSnowflakeList(honeypotRaw.channelIds, "honeypot.channelIds"),
      quarantineRoleId: parseOptionalSnowflake(honeypotRaw.quarantineRoleId, "honeypot.quarantineRoleId"),
      deleteTriggerMessage: parseBoolean(honeypotRaw.deleteTriggerMessage, false, "honeypot.deleteTriggerMessage"),
      ignoreMembersOlderThanMs: parseNonNegativeNumber(
        honeypotRaw.ignoreMembersOlderThanMs,
        DEFAULT_NEW_MEMBER_AGE_MS,
        "honeypot.ignoreMembersOlderThanMs",
      ),
      ignoreAccountsOlderThanMs: parseNonNegativeNumber(
        honeypotRaw.ignoreAccountsOlderThanMs,
        DEFAULT_NEW_ACCOUNT_AGE_MS,
        "honeypot.ignoreAccountsOlderThanMs",
      ),
    },
    labyrinth: {
      entryRoleId: parseOptionalSnowflake(labyrinthRaw.entryRoleId, "labyrinth.entryRoleId"),
      verifiedRoleIds: parseSnowflakeList(labyrinthRaw.verifiedRoleIds, "labyrinth.verifiedRoleIds"),
    },
    welcome,
    autoroles: parseSnowflakeList(root.autoroles, "autoroles"),
  };
};

export class HkGuardConfigLoader {
  private cachedMtimeMs = 0;

  private cachedConfig: HkGuardConfig = parseGuardConfigJson("{}");

  constructor(
    private readonly filePath: string,
    private readonly logger: Logger,
    options?: { watchFileChanges?: boolean },
  ) {
    if (options?.watchFileChanges !== false) {
      watchFile(this.filePath, { interval: 1500 }, () => {
        this.invalidateCache();
        this.logger.debug("HK guard config file watch fired; cache invalidated.", { path: this.filePath });
      });
    }
  }

  get configPath(): string {
    return this.filePath;
  }

  invalidateCache(): void {
    this.cachedMtimeMs = Number.NEGATIVE_INFINITY;
  }

  getSnapshot(): HkGuardConfig {
    if (!existsSync(this.filePath)) {
      if (this.cachedMtimeMs !== -1) {
        this.cachedMtimeMs = -1;
        this.cachedConfig = parseGuardConfigJson("{}");
      }
      return this.cachedConfig;
    }

    const mtime = statSync(this.filePath).mtimeMs;
    if (mtime === this.cachedMtimeMs) {
      return this.cachedConfig;
    }

    try {
      this.cachedConfig = parseGuardConfigJson(readFileSync(this.filePath, "utf8"));
      this.cachedMtimeMs = mtime;
      this.logger.info("Loaded HK guard config.", { path: this.filePath });
    } catch (error) {
      this.logger.warn("Failed to parse HK guard config; keeping previous snapshot.", {
        path: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return this.cachedConfig;
  }
}
