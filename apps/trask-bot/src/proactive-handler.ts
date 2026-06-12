import { randomUUID } from "node:crypto";

import { MessageFlags, type Client, type Message, type NewsChannel, type TextChannel } from "discord.js";

import type { TraskBotConfig } from "@openkotor/config";
import type { Logger } from "@openkotor/core";
import type { JsonTraskQueryRepository } from "@openkotor/persistence";
import {
  classifyTraskProactiveMessage,
  createEmbeddingClient,
  createOpenAiClient,
  formatDiscordAskDisplay,
  type ResearchWizardBriefAnswer,
  type ResearchWizardClient,
  scoreLexicalResearchAlignment,
  scoreResearchAlignment,
} from "@openkotor/trask";

type Pending = {
  messageId: string;
  channelId: string;
  guildId: string | null;
  authorId: string;
  rawContent: string;
  content: string;
  directMention: boolean;
  generation: number;
};

const PROACTIVE_MIN_CITED_SOURCES = 2;
const MARKDOWN_LINK_RE = /\[[^\]]+\]\(https?:\/\/[^)]+\)/g;
const TRAILING_MARKDOWN_LINK_RE = /(\s*\[[^\]]+\]\(https?:\/\/[^)]+\))\s*$/;

type ProactiveAuditTrace = Array<{
  phase: string;
  detail: string;
  diag?: Record<string, string | number | boolean>;
}>;

type ProactiveAuditExtras = {
  sources?: ResearchWizardBriefAnswer["approvedSources"];
  retrievedSources?: ResearchWizardBriefAnswer["retrievedSources"];
  visitedUrls?: readonly string[];
};

const isTextableChannel = (channel: Message["channel"]): channel is TextChannel | NewsChannel => {
  return channel.isTextBased() && !channel.isDMBased();
};

const toAuditTrace = (
  phase: string,
  detail: string,
  diag?: Record<string, string | number | boolean>,
): ProactiveAuditTrace[number] => ({
  phase,
  detail,
  ...(diag ? { diag } : {}),
});

const resolveProactiveChannelIds = (config: TraskBotConfig): string[] => {
  return config.proactive.channelIds.length > 0 ? config.proactive.channelIds : config.approvedChannelIds;
};

const stripBotMention = (content: string, botUserId: string | undefined): string => {
  if (!botUserId) return content;
  return content
    .replace(new RegExp(`<@!?${botUserId}>`, "g"), "")
    .replace(/\s+/g, " ")
    .trim();
};

const countVisibleLinks = (content: string): number => [...content.matchAll(MARKDOWN_LINK_RE)].length;

const trimLinePreservingTrailingCitation = (line: string, maxChars: number): string => {
  if (line.length <= maxChars) return line;
  const trailing = line.match(TRAILING_MARKDOWN_LINK_RE)?.[1] ?? "";
  if (!trailing || trailing.length >= maxChars - 2) {
    return `${line.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }

  const prefixMax = Math.max(0, maxChars - trailing.length - 2);
  return `${line.slice(0, prefixMax).trimEnd()}…${trailing}`;
};

const formatProactiveOutbound = (display: string, maxChars: number): string => {
  const prefix = "A calm Jedi: ";
  const lines = display.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const out: string[] = [];
  let usedChars = prefix.length;

  for (const line of lines) {
    const separatorChars = out.length > 0 ? 1 : 0;
    const remaining = maxChars - usedChars - separatorChars;
    if (remaining <= 0) break;

    const trimmed = trimLinePreservingTrailingCitation(line, remaining);
    if (!trimmed.trim()) continue;

    out.push(trimmed);
    usedChars += separatorChars + trimmed.length;
  }

  return `${prefix}${out.join("\n")}`.trim();
};

const shouldIgnoreMessage = (message: Message, config: TraskBotConfig): boolean => {
  if (message.author.bot) {
    return true;
  }

  if (!message.guildId || !isTextableChannel(message.channel)) {
    return true;
  }

  const content = message.content.trim();

  if (content.length === 0) {
    return true;
  }

  if (content.length < config.proactive.minMessageLength || content.length > config.proactive.maxMessageLength) {
    return true;
  }

  if (content.startsWith("/")) {
    return true;
  }

  return false;
};

export const registerTraskProactiveHandlers = (
  client: Client,
  config: TraskBotConfig,
  researchWizard: ResearchWizardClient,
  logger: Logger,
  queryRepository?: JsonTraskQueryRepository,
): void => {
  const openAi = createOpenAiClient(config.ai);
  const embeddingRuntime = createEmbeddingClient(config.ai);

  if (!openAi) {
    logger.warn("Trask proactive mode needs a configured Hugging Face or Cloudflare AI provider for classification and embeddings.");
    return;
  }

  const channelAllowlist = new Set(resolveProactiveChannelIds(config));

  if (channelAllowlist.size === 0) {
    logger.warn(
      "Trask proactive mode needs TRASK_PROACTIVE_CHANNEL_IDS or TRASK_APPROVED_CHANNEL_IDS — no channels resolved; proactive listener not attached.",
    );
    return;
  }

  const isAllowedGuild = (guildId: string | null): boolean => {
    if (config.allowedGuildIds.length === 0) {
      return true;
    }

    return guildId !== null && config.allowedGuildIds.includes(guildId);
  };

  const pendingByChannel = new Map<string, Pending>();
  const generationByChannel = new Map<string, number>();
  const timers = new Map<string, NodeJS.Timeout>();
  const userCooldownUntil = new Map<string, number>();

  const isSuperseded = (pending: Pending): boolean => {
    const current = pendingByChannel.get(pending.channelId);
    return (
      (current != null && current.messageId !== pending.messageId) ||
      (generationByChannel.get(pending.channelId) ?? pending.generation) !== pending.generation
    );
  };

  const hasCompetingHumanReply = async (
    channel: Message["channel"] & { messages: { fetch: TextChannel["messages"]["fetch"] } },
    pending: Pending,
  ): Promise<{ id: string } | null> => {
    const competing = await channel.messages.fetch({ limit: 20, after: pending.messageId }).catch(() => null);
    if (!competing) {
      return null;
    }

    for (const [, newer] of competing) {
      if (newer.author.bot || newer.author.id === pending.authorId) {
        continue;
      }
      if (newer.content.trim().length >= config.proactive.competingReplyMinLength) {
        return { id: newer.id };
      }
    }
    return null;
  };

  const appendProactiveAudit = async (
    pending: Pending,
    input: {
      status: "complete" | "failed";
      answer?: string | null;
      error?: string | null;
      sources?: ResearchWizardBriefAnswer["approvedSources"];
      retrievedSources?: ResearchWizardBriefAnswer["retrievedSources"];
      visitedUrls?: readonly string[];
      trace: ProactiveAuditTrace;
    },
  ): Promise<void> => {
    if (!queryRepository) return;
    const queryId = randomUUID();
    const threadId = randomUUID();
    const createdAt = new Date().toISOString();
    await queryRepository.append({
      queryId,
      threadId,
      userId: pending.authorId,
      query: pending.content,
      status: input.status,
      answer: input.answer ?? null,
      sources: (input.sources ?? []).map((source) => ({
        id: source.id,
        name: source.name,
        url: source.homeUrl,
      })),
      retrievedSources: (input.retrievedSources ?? []).map((source) => ({
        id: source.id,
        name: source.name,
        url: source.homeUrl,
      })),
      visitedUrls: [...(input.visitedUrls ?? [])],
      error: input.error ?? null,
      createdAt,
      completedAt: createdAt,
      liveTrace: input.trace.map((event) => ({
        at: createdAt,
        phase: event.phase,
        detail: event.detail,
        ...(event.diag ? { diag: event.diag } : {}),
      })),
      groundingStatus: input.status === "complete" ? "grounded" : "failed",
    });
  };

  const auditFailure = (
    pending: Pending,
    error: string,
    trace: ProactiveAuditTrace,
    extra?: ProactiveAuditExtras,
  ): Promise<void> => appendProactiveAudit(pending, { status: "failed", error, trace, ...extra });

  const clearTimer = (channelId: string): void => {
    const existing = timers.get(channelId);

    if (existing) {
      clearTimeout(existing);
      timers.delete(channelId);
    }
  };

  const processPending = async (channelId: string): Promise<void> => {
    timers.delete(channelId);
    const pending = pendingByChannel.get(channelId);
    pendingByChannel.delete(channelId);

    if (!pending) {
      return;
    }

    try {
      const channel = await client.channels.fetch(channelId);

      if (!channel || !("messages" in channel) || channel.isDMBased()) {
        await auditFailure(pending, "proactive channel unavailable or not text-based", [
          { phase: "proactive_suppress", detail: "Channel fetch failed or channel is DM-based." },
        ]);
        return;
      }

      const trigger = await channel.messages.fetch(pending.messageId).catch(() => null);

      if (!trigger || trigger.content.trim() !== pending.rawContent.trim()) {
        await auditFailure(pending, "trigger message changed or disappeared before debounce completed", [
          toAuditTrace("proactive_suppress", "Trigger message changed or disappeared."),
        ]);
        return;
      }

      const competing = pending.directMention ? null : await hasCompetingHumanReply(channel, pending);

      if (competing) {
        logger.debug("Skipping proactive reply — competing human message detected.", {
          channelId,
          triggerId: pending.messageId,
          competitorId: competing.id,
        });
        await auditFailure(
          pending,
          "competing human answer suppressed proactive reply",
          [
            toAuditTrace("proactive_trigger", "KOTOR question candidate waited for human replies."),
            toAuditTrace("proactive_suppress", "A human replied before Trask.", {
              competitor_message_id: competing.id,
            }),
          ],
        );
        return;
      }

      const classification = await classifyTraskProactiveMessage(
        openAi,
        config.proactive.classifierModel,
        pending.content,
      );

      if (
        !classification ||
        !classification.isQuestion ||
        !classification.kotorRelevant ||
        classification.confidence < config.proactive.classifierMinConfidence
      ) {
        logger.debug("Skipping proactive reply — classifier rejected message.", {
          channelId,
          classification,
        });
        await auditFailure(pending, "classifier rejected proactive reply", [
          toAuditTrace("proactive_classify", "Classifier rejected the message.", {
            is_question: Boolean(classification?.isQuestion),
            kotor_relevant: Boolean(classification?.kotorRelevant),
            confidence: classification?.confidence ?? 0,
          }),
        ]);
        return;
      }

      const now = Date.now();
      const cooldownUntil = userCooldownUntil.get(pending.authorId) ?? 0;

      if (!pending.directMention && cooldownUntil > now) {
        logger.debug("Skipping proactive reply — user cooldown.", { authorId: pending.authorId });
        await auditFailure(pending, "user cooldown suppressed proactive reply", [
          toAuditTrace("proactive_suppress", "User cooldown is active.", {
            cooldown_remaining_ms: cooldownUntil - now,
          }),
        ]);
        return;
      }

      if (isSuperseded(pending)) {
        await auditFailure(pending, "superseded by newer channel activity before research started", [
          toAuditTrace("proactive_suppress", "A newer message replaced this proactive candidate."),
        ]);
        return;
      }

      const brief = (await researchWizard.answerForSurface(
        pending.content,
        "discord",
        undefined,
        {
          ...(pending.guildId ? { destinationGuildId: pending.guildId } : {}),
          destinationChannelId: pending.channelId,
          authorizedDiscordChannelIds: config.approvedChannelIds,
        },
      )) as ResearchWizardBriefAnswer;

      if (brief.approvedSources.length < PROACTIVE_MIN_CITED_SOURCES) {
        logger.debug("Skipping proactive reply — insufficient cited sources.", {
          channelId,
          citedSources: brief.approvedSources.length,
          retrievedSources: brief.retrievedSources.length,
        });
        await auditFailure(
          pending,
          "citation gate suppressed proactive reply",
          [
            toAuditTrace("proactive_evidence", "Research completed but did not produce enough cited sources for an unsolicited reply.", {
              cited_sources: brief.approvedSources.length,
              retrieved_sources: brief.retrievedSources.length,
              minimum_cited_sources: PROACTIVE_MIN_CITED_SOURCES,
            }),
          ],
          {
            sources: brief.approvedSources,
            retrievedSources: brief.retrievedSources,
            visitedUrls: brief.visitedUrls,
          },
        );
        return;
      }

      if (isSuperseded(pending)) {
        await auditFailure(
          pending,
          "superseded by newer channel activity after research completed",
          [{ phase: "proactive_suppress", detail: "Discarded stale research after a newer message arrived." }],
          { retrievedSources: brief.retrievedSources, visitedUrls: brief.visitedUrls },
        );
        return;
      }

      let similarity = 1;
      if (embeddingRuntime) {
        const alignmentInput = {
          question: pending.content,
          answerMarkdown: brief.answer,
          researchReport: brief.researchReport,
        };
        try {
          similarity = await scoreResearchAlignment(embeddingRuntime.client, embeddingRuntime.model, alignmentInput);
        } catch (error) {
          similarity = scoreLexicalResearchAlignment(alignmentInput);
          logger.warn("Proactive embedding alignment failed; using lexical alignment fallback.", {
            channelId,
            similarity,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      } else {
        similarity = scoreLexicalResearchAlignment({
          question: pending.content,
          answerMarkdown: brief.answer,
          researchReport: brief.researchReport,
        });
        logger.debug("Using proactive lexical semantic gate — no embedding-capable provider configured.", {
          channelId,
          similarity,
        });
      }

      if (similarity < config.proactive.similarityThreshold) {
        logger.debug("Skipping proactive reply — semantic gate.", { channelId, similarity });
        await auditFailure(
          pending,
          "semantic alignment gate suppressed proactive reply",
          [
            toAuditTrace("proactive_evidence", "Retrieved evidence did not align strongly enough with the trigger.", {
              similarity,
              threshold: config.proactive.similarityThreshold,
            }),
          ],
          { retrievedSources: brief.retrievedSources, visitedUrls: brief.visitedUrls },
        );
        return;
      }

      const display = formatDiscordAskDisplay(brief.answer, brief.approvedSources, {
        maxLines: 2,
        query: pending.content,
      });

      const outbound = formatProactiveOutbound(display, config.proactive.maxReplyChars);

      if (outbound.length === 0) {
        await auditFailure(
          pending,
          "formatted proactive reply was empty",
          [toAuditTrace("proactive_format", "Formatted answer was empty.")],
          {
            sources: brief.approvedSources,
            retrievedSources: brief.retrievedSources,
            visitedUrls: brief.visitedUrls,
          },
        );
        return;
      }

      const visibleLinks = countVisibleLinks(outbound);
      if (visibleLinks < PROACTIVE_MIN_CITED_SOURCES) {
        await auditFailure(
          pending,
          "formatted proactive reply had too few visible citation links",
          [
            toAuditTrace("proactive_format", "Formatted reply was suppressed because citation links would not be visible after clamping.", {
              visible_links: visibleLinks,
              minimum_visible_links: PROACTIVE_MIN_CITED_SOURCES,
            }),
          ],
          {
            sources: brief.approvedSources,
            retrievedSources: brief.retrievedSources,
            visitedUrls: brief.visitedUrls,
          },
        );
        return;
      }

      const lateCompeting = pending.directMention ? null : await hasCompetingHumanReply(channel, pending);
      if (lateCompeting || isSuperseded(pending)) {
        await auditFailure(
          pending,
          lateCompeting
            ? "competing human answer suppressed proactive reply after research"
            : "superseded by newer channel activity before send",
          [
            toAuditTrace(
              "proactive_suppress",
              lateCompeting ? "A human replied while Trask was researching." : "A newer message replaced this proactive candidate before send.",
              lateCompeting ? { competitor_message_id: lateCompeting.id } : undefined,
            ),
          ],
          {
            sources: brief.approvedSources,
            retrievedSources: brief.retrievedSources,
            visitedUrls: brief.visitedUrls,
          },
        );
        return;
      }

      await trigger.reply({
        content: outbound,
        allowedMentions: { repliedUser: false, parse: [] },
        flags: MessageFlags.SuppressEmbeds,
      });

      await appendProactiveAudit(pending, {
        status: "complete",
        answer: outbound,
        sources: brief.approvedSources,
        retrievedSources: brief.retrievedSources,
        visitedUrls: brief.visitedUrls,
        trace: [
          toAuditTrace("proactive_classify", "Classifier accepted KOTOR research question.", {
            confidence: classification.confidence,
            is_question: classification.isQuestion,
            kotor_relevant: classification.kotorRelevant,
          }),
          toAuditTrace("proactive_evidence", "Citation and semantic gates passed.", {
            similarity,
            cited_sources: brief.approvedSources.length,
            retrieved_sources: brief.retrievedSources.length,
          }),
          toAuditTrace("proactive_send", "Trask replied in-channel."),
        ],
      });

      userCooldownUntil.set(pending.authorId, now + config.proactive.userCooldownMs);
    } catch (error) {
      logger.error("Trask proactive pipeline failed.", error instanceof Error ? error : { error: String(error) });
      try {
        await auditFailure(pending, error instanceof Error ? error.message : String(error), [
          toAuditTrace("proactive_error", "Proactive pipeline threw before send."),
        ]);
      } catch (auditError) {
        logger.error(
          "Trask proactive audit write failed.",
          auditError instanceof Error ? auditError : { error: String(auditError) },
        );
      }
    }
  };

  client.on("messageCreate", (message: Message) => {
    if (!isAllowedGuild(message.guildId)) {
      return;
    }

    if (!channelAllowlist.has(message.channelId)) {
      return;
    }

    if (shouldIgnoreMessage(message, config)) {
      return;
    }

    const generation = (generationByChannel.get(message.channelId) ?? 0) + 1;
    generationByChannel.set(message.channelId, generation);

    const rawContent = message.content.trim();
    const botUserId = client.user?.id;
    const directMention = botUserId ? message.mentions.has(botUserId) : false;
    const content = directMention ? stripBotMention(rawContent, botUserId) : rawContent;

    if (content.length < config.proactive.minMessageLength) {
      return;
    }

    const pending: Pending = {
      messageId: message.id,
      channelId: message.channelId,
      guildId: message.guildId,
      authorId: message.author.id,
      rawContent,
      content,
      directMention,
      generation,
    };

    pendingByChannel.set(message.channelId, pending);
    clearTimer(message.channelId);

    const timer = setTimeout(() => {
      void processPending(message.channelId);
    }, config.proactive.debounceMs);

    timers.set(message.channelId, timer);
  });

  logger.info("Trask proactive listener attached.", {
    channelCount: channelAllowlist.size,
    debounceMs: config.proactive.debounceMs,
  });
};
