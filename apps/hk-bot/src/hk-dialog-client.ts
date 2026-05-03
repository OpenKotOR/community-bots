import type { SharedAiConfig } from "@openkotor/config";
import { buildHkDialogMessages, sanitizeHkDialogReply, type HkDialogInput } from "@openkotor/personas";
import type { Logger } from "@openkotor/core";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

import { resolveFreeChatModels, type FreeModelResolverOptions } from "./free-models.js";

export interface HkDialogClientOptions {
  readonly enabled: boolean;
  readonly ai: SharedAiConfig;
  readonly maxReplyChars: number;
  readonly timeoutMs: number;
  readonly resolver?: FreeModelResolverOptions;
  readonly logger?: Pick<Logger, "warn" | "debug">;
}

export interface HkDialogClient {
  generate(input: HkDialogInput): Promise<string | null>;
}

export const sanitizeDiscordOutput = (value: string): string =>
  value.trim().replace(/@(everyone|here)/gi, "@\u200b$1");

export const truncateDiscordOutput = (value: string, limit: number): string => {
  const cleaned = sanitizeDiscordOutput(value);
  if (cleaned.length <= limit) {
    return cleaned;
  }
  if (limit <= 3) {
    return ".".repeat(Math.max(0, limit));
  }
  return `${cleaned.slice(0, limit - 3).trimEnd()}...`;
};

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`HK dialog timed out after ${String(timeoutMs)}ms`)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
};

const createHkOpenAiClient = (ai: SharedAiConfig): OpenAI | null => {
  if (!ai.openAiApiKey) {
    return null;
  }

  return new OpenAI({
    apiKey: ai.openAiApiKey,
    ...(ai.openAiBaseUrl ? { baseURL: ai.openAiBaseUrl } : {}),
    ...(ai.openAiDefaultHeaders ? { defaultHeaders: ai.openAiDefaultHeaders } : {}),
  });
};

const defaultLogger: Pick<Logger, "warn" | "debug"> = {
  warn: () => undefined,
  debug: () => undefined,
};

export const createHkDialogClient = (options: HkDialogClientOptions): HkDialogClient => {
  const client = createHkOpenAiClient(options.ai);
  const logger = options.logger ?? defaultLogger;

  return {
    async generate(input) {
      if (!options.enabled || !client) {
        return null;
      }

      const models = await resolveFreeChatModels(logger, options.resolver);
      if (models.length === 0) {
        return null;
      }

      const messages = buildHkDialogMessages({
        ...input,
        maxCharacters: Math.min(input.maxCharacters, options.maxReplyChars),
      }).map((message) => ({ role: message.role, content: message.content }) satisfies ChatCompletionMessageParam);

      for (const model of models) {
        try {
          const completion = await withTimeout(
            client.chat.completions.create({
              model,
              temperature: 0.35,
              max_tokens: 180,
              stream: false,
              messages,
            }),
            options.timeoutMs,
          );
          const firstChoice = completion.choices.at(0);
          const raw = firstChoice?.message.content;
          if (raw) {
            return sanitizeHkDialogReply(raw, options.maxReplyChars);
          }
        } catch {
          // Try the next explicit free model; fail closed after the list is exhausted.
        }
      }

      return null;
    },
  };
};
