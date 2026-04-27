import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type APIEmbedField,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";

import { loadTraskBotConfig } from "@openkotor/config";
import { createBotClient, createLogger, deployGuildCommands, toErrorMessage } from "@openkotor/core";
import { buildErrorEmbed, buildInfoEmbed, buildSuccessEmbed } from "@openkotor/discord-ui";
import { personaProfiles } from "@openkotor/personas";
import { createDefaultSearchProvider, defaultSourceCatalog, type SourceDescriptor, type SourceKind } from "@openkotor/retrieval";

import { createResearchWizardClient } from "./research-wizard.js";

const logger = createLogger("trask-bot");
const config = loadTraskBotConfig();
const searchProvider = createDefaultSearchProvider({ stateDir: config.chunkDir });
const researchWizard = createResearchWizardClient(config.researchWizard);

const sourceChoices = defaultSourceCatalog.map((source) => ({
  name: source.name,
  value: source.id,
}));

const askCommand = new SlashCommandBuilder()
  .setName("ask")
  .setDescription("Ask Trask to search the approved KOTOR source registry.")
  .addStringOption((option) => {
    return option
      .setName("query")
      .setDescription("What should Trask look up?")
      .setRequired(true)
      .setMaxLength(200);
  });

const sourcesCommand = new SlashCommandBuilder()
  .setName("sources")
  .setDescription("Inspect Trask's approved source policy.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) => {
    return option
      .setName("kind")
      .setDescription("Optionally filter by source type.")
      .addChoices(
        { name: "Website", value: "website" },
        { name: "GitHub", value: "github" },
        { name: "Discord", value: "discord" },
      )
      .setRequired(false);
  });

const reindexCommand = new SlashCommandBuilder()
  .setName("queue-reindex")
  .setDescription("Queue a source refresh job for the ingest worker.")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) => {
    return option
      .setName("source")
      .setDescription("Queue one known source id, or leave blank for all sources.")
      .addChoices(...sourceChoices)
      .setRequired(false);
  });

const commands = [askCommand, sourcesCommand, reindexCommand] as const;

const truncateForDiscord = (value: string, limit: number): string => {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
};

const normalizeWhitespace = (value: string): string => value.replace(/\n{3,}/g, "\n\n").trim();

const splitResearchAnswer = (value: string): { body: string; sourceLines: string[] } => {
  const match = /\nSources\s*\n/i.exec(value);

  if (!match) {
    return {
      body: normalizeWhitespace(value),
      sourceLines: [],
    };
  }

  const body = normalizeWhitespace(value.slice(0, match.index));
  const sourceLines = value
    .slice(match.index + match[0].length)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return { body, sourceLines };
};

const chunkSourceLines = (sourceLines: readonly string[]): APIEmbedField[] => {
  if (sourceLines.length === 0) {
    return [];
  }

  const fields: APIEmbedField[] = [];
  let currentLines: string[] = [];

  for (const line of sourceLines) {
    const candidate = [...currentLines, line].join("\n");

    if (candidate.length > 1024 && currentLines.length > 0) {
      fields.push({
        name: fields.length === 0 ? "Sources" : `Sources ${fields.length + 1}`,
        value: currentLines.join("\n"),
        inline: false,
      });
      currentLines = [line];
      continue;
    }

    currentLines.push(line);
  }

  if (currentLines.length > 0) {
    fields.push({
      name: fields.length === 0 ? "Sources" : `Sources ${fields.length + 1}`,
      value: currentLines.join("\n"),
      inline: false,
    });
  }

  return fields;
};

const buildFallbackSources = (sources: readonly SourceDescriptor[]): APIEmbedField[] => {
  return chunkSourceLines(sources.map((source, index) => `${index + 1}. ${source.name} - ${source.homeUrl}`));
};

const buildResearchEmbed = (rawAnswer: string, approvedSources: readonly SourceDescriptor[]) => {
  const { body, sourceLines } = splitResearchAnswer(rawAnswer);
  const description = truncateForDiscord(body, 4000);
  const sourceFields = sourceLines.length > 0
    ? chunkSourceLines(sourceLines)
    : buildFallbackSources(approvedSources);

  return buildInfoEmbed({
    title: `${personaProfiles.trask.displayName} Briefing`,
    description,
    fields: sourceFields.slice(0, 3),
  });
};

const handleAskCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const query = interaction.options.getString("query", true);

  await interaction.deferReply();

  const result = await researchWizard.answerQuestion(query);
  const embed = buildResearchEmbed(result.answer, result.approvedSources);

  await interaction.editReply({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
};

const handleSourcesCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const requestedKind = interaction.options.getString("kind", false) as SourceKind | null;
  const sources = await searchProvider.listSources();
  const filtered = requestedKind ? sources.filter((source) => source.kind === requestedKind) : sources;

  const embed = buildInfoEmbed({
    title: "Approved Source Policy",
    description: `Trask is pinned to ${filtered.length} approved sources${requestedKind ? ` of type ${requestedKind}` : ""}. This is an admin-facing policy view, not part of the normal user experience.`,
    fields: filtered.slice(0, 10).map((source) => ({
      name: source.name,
      value: `${source.description}\nPolicy: ${source.freshnessPolicy}`,
      inline: false,
    })),
  });

  await interaction.reply({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });
};

const handleReindexCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const sourceId = interaction.options.getString("source", false);
  const result = await searchProvider.queueReindex(sourceId ? [sourceId] : undefined);

  const embed = buildSuccessEmbed({
    title: "Refresh Queued",
    description: `Queued ${result.queuedSourceIds.length} source refresh request(s). The ingest worker queue has been updated.`,
  });

  await interaction.reply({
    embeds: [embed],
    ephemeral: true,
  });
};

const dispatchChatCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  switch (interaction.commandName) {
    case "ask":
      await handleAskCommand(interaction);
      break;
    case "sources":
      await handleSourcesCommand(interaction);
      break;
    case "queue-reindex":
      await handleReindexCommand(interaction);
      break;
    default:
      await interaction.reply({
        embeds: [
          buildErrorEmbed({
            title: "Unknown Command",
            description: `Trask does not recognize /${interaction.commandName}.`,
          }),
        ],
        ephemeral: true,
      });
  }
};

const client = createBotClient();

client.once("ready", (readyClient) => {
  logger.info("Trask is online.", {
    user: readyClient.user.tag,
    approvedGuildCount: config.allowedGuildIds.length,
    approvedChannelCount: config.approvedChannelIds.length,
  });
});

const isAllowedGuild = (guildId: string | null): boolean => {
  if (config.allowedGuildIds.length === 0) return true;
  return guildId !== null && config.allowedGuildIds.includes(guildId);
};

const isAllowedChannel = (channelId: string): boolean => {
  if (config.approvedChannelIds.length === 0) return true;
  return config.approvedChannelIds.includes(channelId);
};

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (!isAllowedGuild(interaction.guildId)) {
    await interaction.reply({
      embeds: [
        buildErrorEmbed({
          title: "Not Available Here",
          description: "Trask is not authorized to operate in this guild.",
        }),
      ],
      ephemeral: true,
    });
    return;
  }

  // Channel restriction only applies to /ask (the content-producing command).
  if (interaction.commandName === "ask" && !isAllowedChannel(interaction.channelId)) {
    await interaction.reply({
      embeds: [
        buildErrorEmbed({
          title: "Wrong Channel",
          description: "Trask can only answer questions in approved channels on this server.",
        }),
      ],
      ephemeral: true,
    });
    return;
  }

  try {
    await dispatchChatCommand(interaction);
  } catch (error) {
    logger.error("Trask command failed.", error);

    const payload = {
      embeds: [
        buildErrorEmbed({
          title: "Operation Failed",
          description: `I ran into a problem: ${toErrorMessage(error)}`,
        }),
      ],
      ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
      return;
    }

    await interaction.reply(payload);
  }
});

const deployables = commands.map((command) => command.toJSON() as RESTPostAPIApplicationCommandsJSONBody);
await deployGuildCommands(config.discord, deployables, logger);
await client.login(config.discord.botToken);