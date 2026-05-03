import { EmbedBuilder, Events, type Client, type GuildMember, type Message, type Role } from "discord.js";

import type { Logger } from "@openkotor/core";

import { getBotMember, mutateMemberRole } from "./member-role-mutate.js";
import type { HkGuardConfig, HkGuardConfigLoader } from "./guard-config.js";

export interface WelcomeTemplateInput {
  readonly userId: string;
  readonly username: string;
  readonly guildName: string;
}

export const renderWelcomeMessage = (template: string, input: WelcomeTemplateInput): string =>
  template
    .replaceAll("$mention", `<@${input.userId}>`)
    .replaceAll("$user", input.username)
    .replaceAll("$server", input.guildName)
    .replaceAll("@everyone", "@\u200beveryone")
    .replaceAll("@here", "@\u200bhere")
    .trim();

export const formatGuardMessage = (
  template: string,
  input: { readonly mention: string; readonly user: string; readonly server: string },
): string =>
  template
    .replaceAll("$mention", input.mention)
    .replaceAll("$user", input.user)
    .replaceAll("$server", input.server)
    .replaceAll("@everyone", "@\u200beveryone")
    .replaceAll("@here", "@\u200bhere")
    .trim();

export const shouldTreatAsFreshJoin = (input: {
  readonly now: number;
  readonly joinedTimestamp: number | null;
  readonly accountCreatedTimestamp: number;
  readonly ignoreMembersOlderThanMs: number;
  readonly ignoreAccountsOlderThanMs: number;
}): boolean => {
  const joinedAt = input.joinedTimestamp ?? input.now;
  return (
    input.now - joinedAt <= input.ignoreMembersOlderThanMs &&
    input.now - input.accountCreatedTimestamp <= input.ignoreAccountsOlderThanMs
  );
};

export const shouldTrustMember = (trustedRoleIds: readonly string[], memberRoleIds: ReadonlySet<string>): boolean =>
  trustedRoleIds.some((roleId) => memberRoleIds.has(roleId));

export const isSuspiciousHoneypotMember = (
  member: Pick<GuildMember, "joinedTimestamp" | "user">,
  config: HkGuardConfig,
  now = Date.now(),
): boolean => {
  return shouldTreatAsFreshJoin({
    now,
    joinedTimestamp: member.joinedTimestamp,
    accountCreatedTimestamp: member.user.createdTimestamp,
    ignoreMembersOlderThanMs: config.honeypot.ignoreMembersOlderThanMs,
    ignoreAccountsOlderThanMs: config.honeypot.ignoreAccountsOlderThanMs,
  });
};

export const shouldIgnoreTrustedMember = (
  member: Pick<GuildMember, "roles">,
  config: HkGuardConfig,
): boolean => config.trustedRoleIds.some((roleId) => member.roles.cache.has(roleId));

const findRole = async (member: GuildMember, roleId: string): Promise<Role | null> =>
  member.guild.roles.cache.get(roleId) ?? (await member.guild.roles.fetch(roleId).catch(() => null));

const logGuardEvent = async (
  client: Client,
  config: HkGuardConfig,
  logger: Logger,
  title: string,
  description: string,
): Promise<void> => {
  if (!config.logChannelId) {
    logger.info(title, { description });
    return;
  }

  try {
    const channel = await client.channels.fetch(config.logChannelId);
    if (!channel?.isTextBased() || channel.isDMBased()) {
      logger.warn("HK guard log channel is not a guild text channel.", { channelId: config.logChannelId });
      return;
    }

    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(title)
          .setDescription(description)
          .setTimestamp(new Date()),
      ],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.warn("HK guard log dispatch failed.", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const applyJoinRoles = async (
  member: GuildMember,
  roleIds: readonly string[],
  logger: Logger,
  reason: string,
): Promise<string[]> => {
  const botMember = await getBotMember(member);
  const assigned: string[] = [];

  for (const roleId of roleIds) {
    const role = await findRole(member, roleId);
    if (!role) {
      logger.warn("HK guard role missing.", { roleId });
      continue;
    }

    const result = await mutateMemberRole(member, role, "add", botMember, reason);
    if (result.kind === "assigned") {
      assigned.push(result.roleName);
    }
  }

  return assigned;
};

const handleMemberJoin = async (
  client: Client,
  member: GuildMember,
  config: HkGuardConfig,
  logger: Logger,
): Promise<void> => {
  if (!config.enabled || shouldIgnoreTrustedMember(member, config)) {
    return;
  }

  const assigned = await applyJoinRoles(
    member,
    [...config.autoroles, ...(config.labyrinth.entryRoleId ? [config.labyrinth.entryRoleId] : [])],
    logger,
    `HK guard join automation for ${member.user.tag}`,
  );

  if (assigned.length > 0) {
    await logGuardEvent(
      client,
      config,
      logger,
      "HK Guard: Join Roles Applied",
      `Statement: ${member.user.tag} received ${assigned.join(", ")}.`,
    );
  }

  if (config.welcome) {
    const channel = await client.channels.fetch(config.welcome.channelId).catch(() => null);
    if (channel?.isTextBased() && !channel.isDMBased()) {
      await channel.send({
        content: renderWelcomeMessage(config.welcome.message, {
          userId: member.id,
          username: member.user.username,
          guildName: member.guild.name,
        }),
        allowedMentions: { users: [member.id], parse: [] },
      });
    }
  }
};

const handleMessageCreate = async (
  client: Client,
  message: Message,
  config: HkGuardConfig,
  logger: Logger,
): Promise<void> => {
  if (!config.enabled || !message.guild || message.author.bot || !config.honeypot.channelIds.includes(message.channelId)) {
    return;
  }

  const member = await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member || shouldIgnoreTrustedMember(member, config) || !isSuspiciousHoneypotMember(member, config)) {
    return;
  }

  if (config.honeypot.deleteTriggerMessage) {
    await message.delete().catch(() => undefined);
  }

  let quarantine = "not configured";
  if (config.honeypot.quarantineRoleId) {
    const assigned = await applyJoinRoles(
      member,
      [config.honeypot.quarantineRoleId],
      logger,
      `HK honeypot quarantine for ${member.user.tag}`,
    );
    quarantine = assigned.length > 0 ? assigned.join(", ") : "role unavailable or blocked";
  }

  await logGuardEvent(
    client,
    config,
    logger,
    "HK Guard: Honeypot Triggered",
    [
      `Observation: ${member.user.tag} posted in a honeypot channel.`,
      `Channel: <#${message.channelId}>`,
      `Quarantine: ${quarantine}`,
    ].join("\n"),
  );
};

export const registerHkGuardHandlers = (
  client: Client,
  logger: Logger,
  configLoader: HkGuardConfigLoader,
): void => {
  client.on(Events.GuildMemberAdd, (member) => {
    void handleMemberJoin(client, member, configLoader.getSnapshot(), logger);
  });

  client.on(Events.MessageCreate, (message) => {
    void handleMessageCreate(client, message, configLoader.getSnapshot(), logger);
  });
};
