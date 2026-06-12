/**
 * Discord citation authorization context for verify/import-smoke scripts.
 * Mirrors `apps/trask-bot` `/ask` options wiring.
 */

export const DEFAULT_DISCORD_VERIFY_CHANNEL_ID = "1497410480208216306";

/** @param {string | undefined} value */
export const parseEnvList = (value) =>
  String(value ?? "")
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

/** @param {NodeJS.ProcessEnv} [env] */
export const discordCitationAuthFromEnv = (env = process.env) => {
  const destinationGuildId =
    env.TRASK_VERIFY_DISCORD_GUILD_ID?.trim()
    || parseEnvList(env.TRASK_ALLOWED_GUILD_IDS)[0]
    || "";
  const destinationChannelId =
    env.TRASK_VERIFY_DISCORD_CHANNEL_ID?.trim()
    || env.TRASK_DISCORD_TEST_CHANNEL_ID?.trim()
    || DEFAULT_DISCORD_VERIFY_CHANNEL_ID;
  const authorizedDiscordChannelIds = parseEnvList(env.TRASK_APPROVED_CHANNEL_IDS);
  return {
    ...(destinationGuildId ? { destinationGuildId } : {}),
    destinationChannelId,
    ...(authorizedDiscordChannelIds.length ? { authorizedDiscordChannelIds } : {}),
  };
};

/**
 * Import-smoke contract: Discord jump links fail closed without auth context.
 * @param {typeof import("@openkotor/trask").isCitableCitationUrl} isCitableCitationUrl
 */
export const assertDiscordCitationAuthContract = (isCitableCitationUrl) => {
  const jumpUrl =
    "https://discord.com/channels/111122223333444444/1497410480208216306/999888777666555555";
  if (isCitableCitationUrl(jumpUrl, "discord")) {
    throw new Error("discord jump citation must fail closed without authorization context");
  }
  const auth = {
    destinationGuildId: "111122223333444444",
    destinationChannelId: "1497410480208216306",
    authorizedDiscordChannelIds: ["1497410480208216306"],
  };
  if (!isCitableCitationUrl(jumpUrl, "discord", auth)) {
    throw new Error("discord jump citation must authorize with destination guild/channel context");
  }
};
