import type { ChatInputCommandInteraction } from "discord.js";

import { toErrorMessage } from "@openkotor/core";

export type AskInteractionLogger = {
  warn(message: string, context?: Record<string, unknown>): void;
};

export const DISCORD_UNKNOWN_INTERACTION_CODE = 10062;

export const isUnknownInteractionError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as { code?: unknown };
  return candidate.code === DISCORD_UNKNOWN_INTERACTION_CODE;
};

/**
 * Acknowledge /ask within Discord's initial interaction window.
 * Call this as early as possible in the interaction handler.
 */
export const ensureAskDeferred = async (
  interaction: ChatInputCommandInteraction,
  logger: AskInteractionLogger,
): Promise<boolean> => {
  if (interaction.deferred || interaction.replied) {
    return true;
  }

  try {
    await interaction.deferReply();
    return true;
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      logger.warn("Discord reported stale interaction before deferReply; skipping command execution.", {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });
      return false;
    }

    logger.warn("Trask /ask deferReply failed; retrying with ephemeral response.", {
      error: toErrorMessage(error),
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    });
  }

  if (interaction.deferred || interaction.replied) {
    return true;
  }

  try {
    await interaction.deferReply({ ephemeral: true });
    return true;
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      logger.warn("Discord reported stale interaction during deferReply fallback; skipping command execution.", {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });
      return false;
    }
    throw error;
  }
};

export type ChatReplyPayload = Parameters<ChatInputCommandInteraction["reply"]>[0];

export const safeReply = async (
  interaction: ChatInputCommandInteraction,
  payload: ChatReplyPayload,
  logger: AskInteractionLogger,
): Promise<void> => {
  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      logger.warn("Skipping reply for stale Discord interaction.", {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });
      return;
    }
    throw error;
  }
};

export const safeEditReply = async (
  interaction: ChatInputCommandInteraction,
  payload: Parameters<ChatInputCommandInteraction["editReply"]>[0],
  logger: AskInteractionLogger,
): Promise<void> => {
  try {
    await interaction.editReply(payload);
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      logger.warn("Skipping editReply for stale Discord interaction.", {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
      });
      return;
    }
    throw error;
  }
};
