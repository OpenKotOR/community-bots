/** Discord internal `discord://` URLs and public jump links for citations. */

export interface DiscordPassageLocator {
  readonly guildId?: string;
  readonly channelId?: string;
  readonly firstMessageId?: string;
}

const DISCORD_INTERNAL_RE = /^discord:\/\/channels\/(\d+)\/(\d+)(?:-(\d+))?$/iu;

export const parseDiscordInternalUrl = (
  url: string,
): { channelId: string; firstMessageId: string; lastMessageId?: string } | null => {
  const match = url.trim().match(DISCORD_INTERNAL_RE);
  if (!match) return null;
  const parsed: { channelId: string; firstMessageId: string; lastMessageId?: string } = {
    channelId: match[1]!,
    firstMessageId: match[2]!,
  };
  if (match[3]) {
    parsed.lastMessageId = match[3];
  }
  return parsed;
};

export const isDiscordJumpUrl = (url: string): boolean =>
  /^https:\/\/discord\.com\/channels\/\d+\/\d+\/\d+/iu.test(url.trim());

export const buildDiscordJumpUrl = (
  guildId: string,
  channelId: string,
  messageId: string,
): string | null => {
  const guild = guildId.trim();
  const channel = channelId.trim();
  const message = messageId.trim();
  if (!guild || !channel || !message) return null;
  return `https://discord.com/channels/${guild}/${channel}/${message}`;
};

export const resolvePublicCitationUrl = (
  internalOrPublicUrl: string,
  locator?: DiscordPassageLocator,
): string => {
  const trimmed = internalOrPublicUrl.trim();
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (!trimmed.startsWith("discord://")) {
    return trimmed;
  }
  const parsed = parseDiscordInternalUrl(trimmed);
  const guildId = locator?.guildId?.trim() || "";
  const channelId = locator?.channelId?.trim() || parsed?.channelId || "";
  const messageId = locator?.firstMessageId?.trim() || parsed?.firstMessageId || "";
  return buildDiscordJumpUrl(guildId, channelId, messageId) ?? trimmed;
};
