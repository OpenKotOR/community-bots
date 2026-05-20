import { randomUUID } from "node:crypto";

import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";

import { loadTraskBotConfig } from "@openkotor/config";
import {
  createBotClient,
  createLogger,
  deployGlobalCommands,
  deployGuildCommands,
  toErrorMessage,
} from "@openkotor/core";
import { buildErrorEmbed, buildInfoEmbed, buildSuccessEmbed } from "@openkotor/discord-ui";
import { JsonTraskQueryRepository, resolveDataFile } from "@openkotor/persistence";
import { personaProfiles } from "@openkotor/personas";
import { trimTrailingSlashes } from "@openkotor/platform";
import {
  createChunkSearchProvider,
  defaultSourceCatalog,
  type SourceDescriptor,
  type SourceKind,
} from "@openkotor/retrieval";
import {
  createResearchWizardClient,
  formatDiscordAskDisplay,
  setTraskResearchLogSink,
  type ResearchWizardBriefAnswer,
} from "@openkotor/trask";
import { isTraskThreadId } from "@openkotor/trask-http";

import {
  ensureAskDeferred,
  safeEditReply,
  safeReply,
} from "./discord-ask-interaction.js";
import { startDiscordIndexSync } from "./discord-index-sync.js";
import { registerTraskProactiveHandlers } from "./proactive-handler.js";
import { registerTraskWelcomeHandler } from "./welcome-handler.js";
import { startEmbeddedTraskWebUi } from "./web-server.js";

const logger = createLogger("trask-bot");
const config = loadTraskBotConfig();
const searchProvider = createChunkSearchProvider(config.chunkDir);
const DISCORD_ASK_RESPONSE_SLA_MS = 90_000;
const DISCORD_ASK_SYNTHESIS_FAILURE_MESSAGE = "I could not complete live archive synthesis for this question right now.";
const researchGatherTimeoutMs = Math.min(config.researchWizard.gatherTimeoutMs, DISCORD_ASK_RESPONSE_SLA_MS);
if (researchGatherTimeoutMs !== config.researchWizard.gatherTimeoutMs) {
  logger.warn("TRASK_RESEARCH_GATHER_MS exceeds Discord /ask SLA; clamping gather at runtime.", {
    configuredGatherMs: config.researchWizard.gatherTimeoutMs,
    effectiveGatherMs: researchGatherTimeoutMs,
  });
}
const researchWizard = createResearchWizardClient(
  {
    ...config.researchWizard,
    gatherTimeoutMs: researchGatherTimeoutMs,
    timeoutMs: researchGatherTimeoutMs,
  },
  config.ai,
);

setTraskResearchLogSink((line, level) => {
  if (level === "debug") {
    logger.debug(line);
  } else {
    logger.info(line);
  }
});

const queryRepository = new JsonTraskQueryRepository(resolveDataFile(config.queryDataDir, "trask-queries.json"));

const traskHttpRuntime = {
  searchProvider,
  researchWizard,
  queryRepository,
};

const embeddedWeb = startEmbeddedTraskWebUi({ config, runtime: traskHttpRuntime, logger });

if (embeddedWeb) {
  const shutdownWeb = (): void => {
    void embeddedWeb.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once("SIGINT", shutdownWeb);
  process.once("SIGTERM", shutdownWeb);
}

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
      .setMaxLength(200)
      .setAutocomplete(true);
  })
  .addStringOption((option) => {
    return option
      .setName("thread")
      .setDescription("Optional Holocron thread UUID from a browser link (?thread=…).")
      .setRequired(false)
      .setMaxLength(36);
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

const AUTOCOMPLETE_VALUE_CAP = 100;
const AUTOCOMPLETE_MAX_CHOICES = 25;
const AUTOCOMPLETE_MAX_RECENT_PER_USER = 60;
const recentQueriesByUser = new Map<string, string[]>();

const rememberRecentQuery = (userId: string, query: string): void => {
  const text = query.trim().replace(/\s+/g, " ");
  if (text.length < 3) {
    return;
  }

  const current = recentQueriesByUser.get(userId) ?? [];
  const deduped = [text, ...current.filter((entry) => entry.toLowerCase() !== text.toLowerCase())].slice(
    0,
    AUTOCOMPLETE_MAX_RECENT_PER_USER,
  );
  recentQueriesByUser.set(userId, deduped);
};

const buildAskAutocompleteChoices = async (
  userId: string,
  needle: string,
): Promise<{ name: string; value: string }[]> => {
  const uniq: string[] = [];
  const seen = new Set<string>();
  const n = needle.trim().toLowerCase();
  const recent = recentQueriesByUser.get(userId) ?? [];
  for (const text of recent) {
    if (text.length < 3) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (n && !key.includes(n)) continue;
    uniq.push(text);
    if (uniq.length >= AUTOCOMPLETE_MAX_CHOICES) break;
  }
  return uniq.map((text) => {
    const clipped = text.length > AUTOCOMPLETE_VALUE_CAP ? `${text.slice(0, AUTOCOMPLETE_VALUE_CAP - 1)}…` : text;
    return { name: clipped, value: clipped };
  });
};

const truncateForDiscord = (value: string, limit: number): string => {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
};

const buildResearchEmbed = (
  rawAnswer: string,
  approvedSources: readonly SourceDescriptor[],
  query: string,
) => {
  const title = `${personaProfiles.trask.displayName} Briefing`;
  const description =
    rawAnswer === DISCORD_ASK_SYNTHESIS_FAILURE_MESSAGE
      ? rawAnswer
      : formatDiscordAskDisplay(rawAnswer, approvedSources, { query });

  return buildInfoEmbed({
    title,
    description: truncateForDiscord(description, 4000),
  });
};

const handleAskCommand = async (interaction: ChatInputCommandInteraction): Promise<void> => {
  const query = interaction.options.getString("query", true);
  rememberRecentQuery(interaction.user.id, query);
  const threadOpt = interaction.options.getString("thread")?.trim();
  const threadId = threadOpt && isTraskThreadId(threadOpt) ? threadOpt : randomUUID();

  if (!interaction.deferred && !interaction.replied) {
    const deferred = await ensureAskDeferred(interaction, logger);
    if (!deferred) {
      return;
    }
  }

  const queryId = randomUUID();
  const createdAt = new Date().toISOString();

  try {
    logger.info("Trask /ask research_start", {
      queryId,
      threadId,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      queryPreview: query.slice(0, 120),
    });

    const answerPromise = researchWizard.answerForSurface(query, "discord") as Promise<ResearchWizardBriefAnswer>;
    const timedResult = await Promise.race<
      { kind: "result"; value: ResearchWizardBriefAnswer } | { kind: "timeout" }
    >([
      answerPromise.then((value) => ({ kind: "result", value })),
      new Promise((resolve) => {
        setTimeout(() => resolve({ kind: "timeout" as const }), DISCORD_ASK_RESPONSE_SLA_MS);
      }),
    ]);

    if (timedResult.kind === "timeout") {
      // Prevent unhandled rejections if the research promise fails after timeout.
      void answerPromise.catch(() => undefined);

      const completedAt = new Date().toISOString();
      const timeoutMessage = `I could not complete live archive synthesis within ${Math.floor(DISCORD_ASK_RESPONSE_SLA_MS / 1000)} seconds`;
      await queryRepository.append({
        queryId,
        threadId,
        userId: interaction.user.id,
        query,
        status: "failed",
        answer: null,
        sources: [],
        error: timeoutMessage,
        createdAt,
        completedAt,
      });

      logger.warn("Trask /ask hit Discord response SLA timeout.", {
        guildId: interaction.guildId,
        channelId: interaction.channelId,
        queryId,
        timeoutMs: DISCORD_ASK_RESPONSE_SLA_MS,
      });

      const fallbackEmbed = buildInfoEmbed({
        title: `${personaProfiles.trask.displayName} Briefing`,
        description: timeoutMessage,
      });

      await interaction.editReply({
        embeds: [fallbackEmbed],
        allowedMentions: { parse: [] },
      });
      return;
    }

    const result = timedResult.value;
    logger.info("Trask /ask research_done", {
      queryId,
      approvedSources: result.approvedSources.length,
      retrievedSources: result.retrievedSources.length,
      visitedUrls: result.visitedUrls.length,
      groundingStatus: result.groundingStatus ?? "unknown",
    });
    const completedAt = new Date().toISOString();
    await queryRepository.append({
      queryId,
      threadId,
      userId: interaction.user.id,
      query,
      status: "complete",
      answer: result.answer,
      sources: result.approvedSources.map((source) => ({
        id: source.id,
        name: source.name,
        url: source.homeUrl,
      })),
      retrievedSources: result.retrievedSources.map((source) => ({
        id: source.id,
        name: source.name,
        url: source.homeUrl,
      })),
      visitedUrls: [...result.visitedUrls],
      error: null,
      createdAt,
      completedAt,
    });
    let embed = buildResearchEmbed(result.answer, result.approvedSources, query);
    const holocronBase = config.holocronPublicUrl?.trim();
    if (holocronBase) {
      const url = `${trimTrailingSlashes(holocronBase)}?thread=${encodeURIComponent(threadId)}`;
      embed = embed.addFields({
        name: "Holocron",
        value: `[Continue this thread in the browser](${url})`,
        inline: false,
      });
    }

    await interaction.editReply({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const message = toErrorMessage(error);
    const completedAt = new Date().toISOString();
    await queryRepository.append({
      queryId,
      threadId,
      userId: interaction.user.id,
      query,
      status: "failed",
      answer: null,
      sources: [],
      error: message,
      createdAt,
      completedAt,
    });

    let errorEmbed = buildErrorEmbed({
      title: "Research Failed",
      description: message,
    });
    const holocronBaseErr = config.holocronPublicUrl?.trim();
    if (holocronBaseErr) {
      const url = `${trimTrailingSlashes(holocronBaseErr)}?thread=${encodeURIComponent(threadId)}`;
      errorEmbed = errorEmbed.addFields({
        name: "Holocron",
        value: `[Open this thread in the browser](${url})`,
        inline: false,
      });
    }

    await interaction.editReply({
      embeds: [errorEmbed],
      allowedMentions: { parse: [] },
    });
  }
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
      await safeReply(
        interaction,
        {
          embeds: [
            buildErrorEmbed({
              title: "Unknown Command",
              description: `Trask does not recognize /${interaction.commandName}.`,
            }),
          ],
          ephemeral: true,
        },
        logger,
      );
  }
};

const proactiveChannelIds =
  config.proactive.channelIds.length > 0 ? config.proactive.channelIds : config.approvedChannelIds;

const proactiveRuntimeReady =
  config.proactive.enabled && proactiveChannelIds.length > 0 && Boolean(config.ai.openAiApiKey);
const welcomeRuntimeReady = Boolean(config.welcome?.channelId && config.welcome.message);

const client = createBotClient(
  {
    ...(proactiveRuntimeReady ? { guildMessages: true, messageContent: true } : {}),
    ...(welcomeRuntimeReady ? { guildMembers: true } : {}),
  },
);

if (config.proactive.enabled && !proactiveRuntimeReady) {
  logger.warn("TRASK_PROACTIVE_ENABLED is set but proactive mode cannot start.", {
    hasOpenAiKey: Boolean(config.ai.openAiApiKey),
    resolvedProactiveChannelCount: proactiveChannelIds.length,
    hint: "Set TRASK_APPROVED_CHANNEL_IDS or TRASK_PROACTIVE_CHANNEL_IDS and provide OPENAI_API_KEY (or OPENROUTER_API_KEY).",
  });
}

if (proactiveRuntimeReady) {
  registerTraskProactiveHandlers(client, config, researchWizard, logger, queryRepository);
}

if (welcomeRuntimeReady) {
  registerTraskWelcomeHandler(client, config, logger);
}

client.on("error", (error) => {
  logger.error("Discord client emitted an error.", {
    error: toErrorMessage(error),
  });
});

const stopDiscordIndexSync = startDiscordIndexSync(config, logger);

client.once("ready", (readyClient) => {
  logger.info("Trask is online.", {
    user: readyClient.user.tag,
    approvedGuildCount: config.allowedGuildIds.length,
    approvedChannelCount: config.approvedChannelIds.length,
    discordIndexSyncMs: config.discordSyncIntervalMs,
    discordChannelBlacklistCount: config.discordChannelBlacklist.length,
  });
});

process.on("beforeExit", () => {
  stopDiscordIndexSync?.();
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection in Trask bot.", {
    error: reason instanceof Error ? reason.message : String(reason),
  });
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception in Trask bot.", {
    error: toErrorMessage(error),
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
  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== "ask") {
      return;
    }
    const focused = interaction.options.getFocused(true);
    if (focused.name !== "query") {
      return;
    }
    try {
      const choices = await buildAskAutocompleteChoices(interaction.user.id, focused.value);
      await interaction.respond(choices);
    } catch (error) {
      logger.warn("Trask /ask autocomplete failed.", error instanceof Error ? error : { error: String(error) });
      await interaction.respond([]);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) {
    return;
  }

  const isAsk = interaction.commandName === "ask";
  if (isAsk) {
    const deferred = await ensureAskDeferred(interaction, logger);
    if (!deferred) {
      return;
    }
  }

  if (!isAllowedGuild(interaction.guildId)) {
    const payload = {
      embeds: [
        buildErrorEmbed({
          title: "Not Available Here",
          description: "Trask is not authorized to operate in this guild.",
        }),
      ],
      allowedMentions: { parse: [] as const },
    };

    if (interaction.deferred || interaction.replied) {
      await safeEditReply(interaction, payload, logger);
    } else {
      await safeReply(interaction, { ...payload, ephemeral: true }, logger);
    }
    return;
  }

  // Channel restriction only applies to /ask (the content-producing command).
  if (isAsk && !isAllowedChannel(interaction.channelId)) {
    const payload = {
      embeds: [
        buildErrorEmbed({
          title: "Wrong Channel",
          description: "Trask can only answer questions in approved channels on this server.",
        }),
      ],
      allowedMentions: { parse: [] as const },
    };

    await safeEditReply(interaction, payload, logger);
    return;
  }

  try {
    await dispatchChatCommand(interaction);
  } catch (error) {
    logger.error("Trask command failed.", error instanceof Error ? error : { error: String(error) });

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

    await safeReply(interaction, payload, logger);
  }
});

const resolveSlashGuildTargets = (): string[] => {
  if (config.slashCommandGuildIds.length > 0) {
    return config.slashCommandGuildIds;
  }

  if (config.discord.guildId) {
    return [config.discord.guildId];
  }

  return [];
};

const deployables = commands.map((command) => command.toJSON() as RESTPostAPIApplicationCommandsJSONBody);
const slashGuildTargets = resolveSlashGuildTargets();

const deploySlashCommands = async (): Promise<void> => {
  if (slashGuildTargets.length > 0) {
    for (const guildId of slashGuildTargets) {
      await deployGuildCommands({ ...config.discord, guildId }, deployables, logger);
    }
    return;
  }

  await deployGlobalCommands(config.discord, deployables, logger);
};

await client.login(config.discord.botToken);

void deploySlashCommands().catch((error) => {
  logger.error("Failed to deploy slash commands during startup.", {
    error: toErrorMessage(error),
    slashGuildTargets,
  });
});