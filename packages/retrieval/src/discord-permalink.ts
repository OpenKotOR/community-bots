/** Discord message permalink and chunk URL helpers for Trask community citations. */

const DISCORD_CHUNK_URL_PATTERN =
  /^discord:\/\/approved-channels\/([^/]+)\/([^/-]+)(?:-([^/]+))?$/;

export function buildDiscordMessagePermalink(
  guildId: string,
  channelId: string,
  messageId: string,
): string {
  const guild = guildId.trim();
  const channel = channelId.trim();
  const message = messageId.trim();
  if (!guild || !channel || !message) {
    return "";
  }
  return `https://discord.com/channels/${guild}/${channel}/${message}`;
}

export function parseDiscordChunkUrl(
  url: string,
): { channelId: string; firstMessageId: string; lastMessageId?: string } | null {
  const match = DISCORD_CHUNK_URL_PATTERN.exec(url.trim());
  if (!match) return null;
  const channelId = match[1]?.trim();
  const firstMessageId = match[2]?.trim();
  const lastMessageId = match[3]?.trim();
  if (!channelId || !firstMessageId) return null;
  return lastMessageId
    ? { channelId, firstMessageId, lastMessageId }
    : { channelId, firstMessageId };
}

export function guildIdFromChunkTags(tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    if (tag.startsWith("guild:")) {
      const value = tag.slice("guild:".length).trim();
      if (value) return value;
    }
  }
  return undefined;
}

export function channelIdFromChunkTags(tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    if (tag.startsWith("channel:")) {
      const value = tag.slice("channel:".length).trim();
      if (value) return value;
    }
  }
  return undefined;
}

export function anchorMessageIdFromChunkTags(tags: readonly string[]): string | undefined {
  for (const tag of tags) {
    if (tag.startsWith("anchorMessage:")) {
      const value = tag.slice("anchorMessage:".length).trim();
      if (value) return value;
    }
  }
  return undefined;
}

/**
 * Resolve a chunk record to an HTTPS citation URL when possible.
 * Prefers stored https://discord.com permalinks; falls back to guild id from tags or option.
 */
export function resolveDiscordChunkCitationUrl(
  chunk: { url: string; tags: readonly string[] },
  fallbackGuildId?: string,
): string {
  const url = chunk.url.trim();
  if (url.startsWith("https://discord.com/channels/")) {
    return url;
  }

  const guildId = guildIdFromChunkTags(chunk.tags) ?? fallbackGuildId?.trim();
  const channelFromTags = channelIdFromChunkTags(chunk.tags);
  const anchorFromTags = anchorMessageIdFromChunkTags(chunk.tags);

  const parsed = parseDiscordChunkUrl(url);
  const channelId = channelFromTags ?? parsed?.channelId;
  const messageId = anchorFromTags ?? parsed?.firstMessageId;

  if (guildId && channelId && messageId) {
    return buildDiscordMessagePermalink(guildId, channelId, messageId);
  }

  return url;
}

export function isDiscordCitationUrl(url: string): boolean {
  const trimmed = url.trim();
  return (
    trimmed.startsWith("discord://")
    || trimmed.startsWith("https://discord.com/channels/")
  );
}
