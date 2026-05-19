import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  buildDiscordMessagePermalink,
  defaultSourceCatalog,
  FileChunkStore,
  type ChunkRecord,
  type SourceDescriptor,
  type SourceIndexRecord,
} from "@openkotor/retrieval";

export const DISCORD_EXPORT_SOURCE_ID = "approved-discord-knowledge";

interface ExportContainerPayload {
  container_scope?: string;
  channel?: {
    id?: string;
    name?: string;
    type_name?: string;
  };
  messages?: unknown;
}

interface ExportMessage {
  id?: string;
  timestamp?: string;
  content?: string;
  author?: {
    username?: string;
    global_name?: string;
    bot?: boolean;
  };
  member?: {
    roles?: unknown;
  };
  type?: number;
  referenced_message?: {
    id?: string;
  };
}

const DISCORD_IMPORT_WINDOW_MESSAGES = 25;
const DISCORD_IMPORT_MAX_WORDS = 380;

const normalizeText = (value: string): string => value.replace(/\s+/g, " ").trim();

const sanitizeDiscordText = (value: string): string => {
  return normalizeText(
    value
      .replace(/<@[!&]?\d+>/g, "@user")
      .replace(/<#\d+>/g, "#channel")
      .replace(/https?:\/\/(?:www\.)?discord\.gg\/\S+/gi, "[redacted-invite]")
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]")
      .replace(/(?:mfa\.)?[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[redacted-token]"),
  );
};

const roleLooksStaff = (roles: unknown): boolean => {
  if (!Array.isArray(roles)) return false;
  return roles.some((role) => {
    const label = typeof role === "string"
      ? role
      : typeof role === "object" && role !== null && "name" in role && typeof role.name === "string"
        ? role.name
        : "";
    return /\b(admin|moderator|mod|staff|maintainer)\b/i.test(label);
  });
};

const authorBucket = (message: ExportMessage): "bot" | "staff" | "member" => {
  if (message.author?.bot) return "bot";
  if (roleLooksStaff(message.member?.roles)) return "staff";
  return "member";
};

const authorLabel = (message: ExportMessage): string => {
  const preferred = message.author?.global_name?.trim() || message.author?.username?.trim();
  if (!preferred) return authorBucket(message);
  return sanitizeDiscordText(preferred);
};

const toIso = (value: string | undefined): string => {
  if (!value) return new Date(0).toISOString();
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? new Date(0).toISOString() : new Date(timestamp).toISOString();
};

const messageToLine = (message: ExportMessage): string | null => {
  const content = sanitizeDiscordText(message.content ?? "");
  if (!content) return null;
  const ts = toIso(message.timestamp);
  const author = `${authorLabel(message)} (${authorBucket(message)})`;
  const ref = message.referenced_message?.id ? ` [reply:${message.referenced_message.id}]` : "";
  return `[${ts}] ${author}${ref}: ${content}`;
};

const wordsIn = (value: string): number => value.split(/\s+/).filter(Boolean).length;

const buildDiscordChunkText = (
  channelName: string,
  scope: string,
  lines: readonly string[],
): string => {
  return [
    `Discord archive context`,
    `Channel: ${channelName}`,
    `Scope: ${scope}`,
    "",
    ...lines,
  ].join("\n");
};

const resolveDiscordSource = (): SourceDescriptor => {
  const descriptor = defaultSourceCatalog.find((source) => source.id === DISCORD_EXPORT_SOURCE_ID);
  if (!descriptor) {
    throw new Error(`Source descriptor ${DISCORD_EXPORT_SOURCE_ID} is missing from defaultSourceCatalog.`);
  }
  return descriptor;
};

const loadJsonFile = async <T>(filePath: string): Promise<T> => {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
};

export interface ImportDiscordExportOptions {
  dryRun: boolean;
  chunkStore: FileChunkStore;
  /** Guild id for `https://discord.com/channels/...` permalinks. Loaded from `guild.json` when omitted. */
  guildId?: string;
  onWarn?: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Import a `scripts/export_discord_server.py` tree into `FileChunkStore` chunks for
 * {@link DISCORD_EXPORT_SOURCE_ID}.
 */
export const importDiscordExport = async (
  exportDirArg: string,
  options: ImportDiscordExportOptions,
): Promise<{ chunkCount: number; containerCount: number }> => {
  const warn = options.onWarn ?? (() => {});
  const exportDir = path.resolve(exportDirArg);
  const manifestPath = path.join(exportDir, "manifest.json");
  const containersDir = path.join(exportDir, "containers");
  const manifestStats = await stat(manifestPath);
  if (!manifestStats.isFile()) {
    throw new Error(`Expected manifest file at ${manifestPath}.`);
  }
  const containersStats = await stat(containersDir);
  if (!containersStats.isDirectory()) {
    throw new Error(`Expected containers directory at ${containersDir}.`);
  }
  await loadJsonFile<object>(manifestPath);

  let guildId = options.guildId?.trim() || "";
  if (!guildId) {
    const guildJsonPath = path.join(exportDir, "guild.json");
    try {
      const guildPayload = await loadJsonFile<{ id?: string | number }>(guildJsonPath);
      guildId = String(guildPayload.id ?? "").trim();
    } catch {
      guildId = "";
    }
  }

  const source = resolveDiscordSource();
  const fetchedAt = Date.now();
  const containerFiles = (await readdir(containersDir))
    .filter((name) => name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right));
  const chunks: ChunkRecord[] = [];

  for (const fileName of containerFiles) {
    const fullPath = path.join(containersDir, fileName);
    let payload: ExportContainerPayload;
    try {
      payload = await loadJsonFile<ExportContainerPayload>(fullPath);
    } catch (error) {
      warn("Skipping unreadable container payload.", {
        fileName,
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    const messages = Array.isArray(payload.messages) ? payload.messages as ExportMessage[] : [];
    if (messages.length === 0) continue;
    const channelId = String(payload.channel?.id ?? "").trim();
    if (!channelId) continue;
    const channelName = String(payload.channel?.name ?? "unknown-channel");
    const scope = String(payload.container_scope ?? payload.channel?.type_name ?? "channel");

    const lines = messages
      .map((message) => messageToLine(message))
      .filter((line): line is string => Boolean(line));
    if (lines.length === 0) continue;

    let windowLines: string[] = [];
    let windowWordCount = 0;
    let firstMessageId: string | undefined;
    let lastMessageId: string | undefined;
    let chunkIndex = 0;

    const flushWindow = async (): Promise<void> => {
      if (windowLines.length === 0 || !firstMessageId || !lastMessageId) return;
      const internalUrl = `discord://approved-channels/${channelId}/${firstMessageId}-${lastMessageId}`;
      const permalink = guildId
        ? buildDiscordMessagePermalink(guildId, channelId, firstMessageId)
        : internalUrl;
      const chunkText = buildDiscordChunkText(channelName, scope, windowLines);
      const chunkId = createHash("sha1")
        .update(`${source.id}:${channelId}:${firstMessageId}:${lastMessageId}:${chunkText}`)
        .digest("hex")
        .slice(0, 16);

      const chunkTags = [
        ...source.tags,
        "discord",
        `scope:${scope}`,
        `channel:${channelId}`,
        `anchorMessage:${firstMessageId}`,
        ...(guildId ? [`guild:${guildId}`] : []),
      ];

      const chunk: ChunkRecord = {
        id: chunkId,
        sourceId: source.id,
        sourceName: source.name,
        kind: source.kind,
        url: permalink || internalUrl,
        title: `${source.name}: #${channelName}`,
        chunkText,
        fetchedAt,
        chunkIndex: chunkIndex++,
        tags: chunkTags,
      };

      chunks.push(chunk);
      if (!options.dryRun) {
        await options.chunkStore.saveChunk(chunk);
      }
      windowLines = [];
      windowWordCount = 0;
      firstMessageId = undefined;
      lastMessageId = undefined;
    };

    for (const message of messages) {
      const line = messageToLine(message);
      if (!line) continue;
      const messageId = String(message.id ?? "").trim();
      if (!messageId) continue;

      if (!firstMessageId) firstMessageId = messageId;
      lastMessageId = messageId;
      windowLines.push(line);
      windowWordCount += wordsIn(line);

      if (windowLines.length >= DISCORD_IMPORT_WINDOW_MESSAGES || windowWordCount >= DISCORD_IMPORT_MAX_WORDS) {
        await flushWindow();
      }
    }

    await flushWindow();
  }

  if (!options.dryRun) {
    await options.chunkStore.saveSourceIndex({
      sourceId: source.id,
      sourceName: source.name,
      kind: source.kind,
      url: source.homeUrl,
      chunkCount: chunks.length,
      lastFetchedAt: fetchedAt,
      tags: [...source.tags, "discord"],
    } satisfies SourceIndexRecord);
  }

  return { chunkCount: chunks.length, containerCount: containerFiles.length };
};
