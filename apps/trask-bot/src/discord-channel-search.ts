import type { Client, GuildTextBasedChannel, Message } from "discord.js";

import { buildDiscordMessagePermalink, type SearchHit } from "@openkotor/retrieval";

const DEFAULT_LIMIT = 6;
const DEFAULT_MAX_MESSAGES_PER_CHANNEL = 120;
const DEFAULT_MAX_CHANNELS = 8;

export interface LiveDiscordSearchOptions {
  client: Client;
  guildId: string;
  channelIds: readonly string[];
  query: string;
  limit?: number;
  maxMessagesPerChannel?: number;
  maxChannels?: number;
  deadlineMs?: number;
}

const tokenize = (value: string): string[] =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3);

const scoreMessage = (queryTokens: readonly string[], content: string): number => {
  const messageTokens = tokenize(content);
  if (messageTokens.length === 0 || queryTokens.length === 0) return 0;
  let score = 0;
  for (const token of queryTokens) {
    score += messageTokens.filter((entry) => entry === token).length;
  }
  return score;
};

const isTextChannel = (channel: unknown): channel is GuildTextBasedChannel => {
  if (!channel || typeof channel !== "object") return false;
  return "messages" in channel && typeof (channel as GuildTextBasedChannel).messages?.fetch === "function";
};

const messageContent = (message: Message): string => {
  const base = message.content?.trim() ?? "";
  const embedText = message.embeds
    .map((embed) => [embed.title, embed.description, embed.url].filter(Boolean).join(" "))
    .join(" ");
  return [base, embedText].filter(Boolean).join("\n").trim();
};

export async function searchLiveDiscordHistory(
  options: LiveDiscordSearchOptions,
): Promise<SearchHit[]> {
  const queryTokens = tokenize(options.query);
  if (queryTokens.length === 0) return [];

  const guildId = options.guildId.trim();
  if (!guildId) return [];

  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxMessagesPerChannel = options.maxMessagesPerChannel ?? DEFAULT_MAX_MESSAGES_PER_CHANNEL;
  const maxChannels = Math.max(1, options.maxChannels ?? DEFAULT_MAX_CHANNELS);
  const deadline = options.deadlineMs ? Date.now() + options.deadlineMs : undefined;

  const channelIds = [...new Set(options.channelIds.map((id) => id.trim()).filter(Boolean))].slice(0, maxChannels);
  const candidates: SearchHit[] = [];

  for (const channelId of channelIds) {
    if (deadline !== undefined && Date.now() >= deadline) break;

    const channel = await options.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !isTextChannel(channel)) continue;

    let remaining = maxMessagesPerChannel;
    let before: string | undefined;
    const collected: Message[] = [];

    while (remaining > 0) {
      if (deadline !== undefined && Date.now() >= deadline) break;
      const batchSize = Math.min(100, remaining);
      const fetchOptions = before ? { limit: batchSize, before } : { limit: batchSize };
      const batch = await channel.messages.fetch(fetchOptions).catch(() => null);
      if (!batch || batch.size === 0) break;

      const ordered = [...batch.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
      collected.push(...ordered);
      remaining -= ordered.length;
      const oldest = ordered[0];
      if (!oldest || batch.size < batchSize) break;
      before = oldest.id;
    }

    for (const message of collected) {
      const content = messageContent(message);
      if (!content) continue;
      const score = scoreMessage(queryTokens, content);
      if (score <= 0) continue;

      const permalink = buildDiscordMessagePermalink(guildId, channelId, message.id);
      if (!permalink) continue;

      const channelLabel = "name" in channel && typeof channel.name === "string" ? channel.name : channelId;
      candidates.push({
        sourceId: "approved-discord-knowledge",
        sourceName: "Approved Discord Knowledge",
        kind: "discord",
        title: `#${channelLabel}`,
        snippet: content.slice(0, 800) + (content.length > 800 ? "\u2026" : ""),
        url: permalink,
        score,
        tags: ["discord", "live", `channel:${channelId}`],
      });
    }
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function mergeDiscordSearchHits(
  ...groups: readonly (readonly SearchHit[])[]
): SearchHit[] {
  const byUrl = new Map<string, SearchHit>();
  for (const group of groups) {
    for (const hit of group) {
      const key = hit.url.trim().toLowerCase();
      if (!key) continue;
      const existing = byUrl.get(key);
      if (!existing || hit.score > existing.score) {
        byUrl.set(key, hit);
      }
    }
  }
  return [...byUrl.values()].sort((a, b) => b.score - a.score);
}
