/**
 * Trask / Holocron LLM resolution: OpenCode or LiteLLM proxy first, then direct keys.
 * Defaults to free-tier chat models (OpenRouter :free / openrouter/free) with paid fallbacks.
 */

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/** Free-first chat models (OpenRouter-compatible ids). Matches llm_fallbacks ordering intent. */
export const TRASK_FREE_CHAT_MODELS = [
  "openrouter/openrouter/free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  "qwen/qwen-3-32b-instruct:free",
] as const;

/** Paid fallbacks tried after free models when keys allow. */
export const TRASK_PAID_CHAT_MODEL_FALLBACKS = ["openrouter/openrouter/auto", "gpt-4o-mini"] as const;

export type TraskLlmResolved = {
  openAiApiKey: string | undefined;
  openAiBaseUrl: string | undefined;
  openAiDefaultHeaders: Record<string, string> | undefined;
  chatModel: string;
  chatModelFallbacks: readonly string[];
  /** Human-readable provider hint for logs (not a secret). */
  providerHint: string;
};

const readOptionalEnv = (name: string, env: NodeJS.ProcessEnv): string | undefined => {
  const value = env[name]?.trim();
  return value ? value : undefined;
};

const readListEnv = (name: string, env: NodeJS.ProcessEnv): string[] => {
  const value = readOptionalEnv(name, env);
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
};

export const stripTraskModelPrefix = (modelId: string): string => {
  const trimmed = modelId.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("openrouter:")) return trimmed.slice("openrouter:".length).trim();
  if (trimmed.startsWith("litellm:")) return trimmed.slice("litellm:".length).trim();
  return trimmed;
};

const normalizeOpenAiCompatibleBaseUrl = (url: string): string => {
  const trimmed = url.trim().replace(/\/+$/u, "");
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
};

const uniqueModels = (models: readonly string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of models) {
    const id = stripTraskModelPrefix(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
};

const buildOpenRouterHeaders = (env: NodeJS.ProcessEnv): Record<string, string> | undefined => {
  const referer = readOptionalEnv("OPENROUTER_HTTP_REFERER", env);
  const title = readOptionalEnv("OPENROUTER_APP_TITLE", env);
  const headers: Record<string, string> = {};
  if (referer) headers["HTTP-Referer"] = referer;
  if (title) headers["X-Title"] = title;
  return Object.keys(headers).length > 0 ? headers : undefined;
};

const isOpenRouterBase = (baseUrl: string | undefined): boolean =>
  Boolean(baseUrl && /openrouter\.ai/i.test(baseUrl));

/** True when any configured path can reach an OpenAI-compatible chat API. */
export const hasTraskLlmProvider = (env: NodeJS.ProcessEnv = process.env): boolean => {
  if (
    readOptionalEnv("TRASK_LLM_BASE_URL", env)
    || readOptionalEnv("OPENCODE_LLM_PROXY_URL", env)
    || readOptionalEnv("LITELLM_PROXY_URL", env)
  ) {
    return true;
  }
  const keys = [
    "OPENAI_API_KEY",
    "OPENROUTER_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
    "GROQ_API_KEY",
    "ANTHROPIC_API_KEY",
    "LITELLM_API_KEY",
    "LITELLM_MASTER_KEY",
    "OPENCODE_LLM_PROXY_TOKEN",
  ] as const;
  return keys.some((name) => Boolean(readOptionalEnv(name, env)));
};

/**
 * Resolve API base URL, key, default chat model, and rewrite fallbacks for Trask.
 * Prefer free models unless TRASK_LLM_PROFILE=paid or only a paid OpenAI key is set.
 */
export const resolveTraskLlm = (
  env: NodeJS.ProcessEnv,
  options: { defaultPaidChatModel: string },
): TraskLlmResolved => {
  const proxyRaw =
    readOptionalEnv("TRASK_LLM_BASE_URL", env)
    ?? readOptionalEnv("OPENCODE_LLM_PROXY_URL", env)
    ?? readOptionalEnv("LITELLM_PROXY_URL", env);

  const openAiKeyDirect = readOptionalEnv("OPENAI_API_KEY", env);
  const openRouterKey = readOptionalEnv("OPENROUTER_API_KEY", env);
  const groqKey = readOptionalEnv("GROQ_API_KEY", env);
  const geminiKey = readOptionalEnv("GEMINI_API_KEY", env) ?? readOptionalEnv("GOOGLE_API_KEY", env);
  const anthropicKey = readOptionalEnv("ANTHROPIC_API_KEY", env);

  let openAiBaseUrl = readOptionalEnv("OPENAI_BASE_URL", env);
  let openAiApiKey = openAiKeyDirect;
  let providerHint = "none";

  if (proxyRaw) {
    openAiBaseUrl = normalizeOpenAiCompatibleBaseUrl(proxyRaw);
    openAiApiKey =
      readOptionalEnv("OPENCODE_LLM_PROXY_TOKEN", env)
      ?? readOptionalEnv("LITELLM_API_KEY", env)
      ?? readOptionalEnv("LITELLM_MASTER_KEY", env)
      ?? openAiApiKey
      ?? openRouterKey
      ?? groqKey
      ?? geminiKey
      ?? anthropicKey
      ?? "local";
    providerHint = readOptionalEnv("OPENCODE_LLM_PROXY_URL", env) ? "opencode-llm-proxy" : "litellm-proxy";
  } else if (!openAiApiKey) {
    if (openRouterKey) {
      openAiApiKey = openRouterKey;
      providerHint = "openrouter";
    } else if (groqKey) {
      openAiApiKey = groqKey;
      providerHint = "groq";
    } else if (geminiKey) {
      openAiApiKey = geminiKey;
      providerHint = "gemini";
    } else if (anthropicKey) {
      openAiApiKey = anthropicKey;
      providerHint = "anthropic";
    }
  } else {
    providerHint = "openai";
  }

  if (!openAiBaseUrl) {
    if (openRouterKey && openAiApiKey === openRouterKey) {
      openAiBaseUrl = OPENROUTER_BASE_URL;
    } else if (groqKey && openAiApiKey === groqKey) {
      openAiBaseUrl = GROQ_BASE_URL;
    } else if (openRouterKey && !openAiKeyDirect) {
      openAiBaseUrl = OPENROUTER_BASE_URL;
      if (!openAiApiKey) {
        openAiApiKey = openRouterKey;
        providerHint = "openrouter";
      }
    }
  }

  const llmProfile = readOptionalEnv("TRASK_LLM_PROFILE", env)?.toLowerCase();
  const preferFree = llmProfile !== "paid";
  const hasDirectOpenAi = Boolean(openAiKeyDirect);
  const usesOpenRouter =
    Boolean(openRouterKey) || isOpenRouterBase(openAiBaseUrl) || providerHint === "openrouter";
  const usesProxy = Boolean(proxyRaw);

  const explicitChat =
    readOptionalEnv("OPENAI_CHAT_MODEL", env)
    ?? readOptionalEnv("FAST_LLM", env)
    ?? readOptionalEnv("SMART_LLM", env);

  let chatModel: string;
  if (explicitChat) {
    chatModel = stripTraskModelPrefix(explicitChat);
  } else if (preferFree && (usesProxy || usesOpenRouter || !hasDirectOpenAi)) {
    chatModel = TRASK_FREE_CHAT_MODELS[0]!;
  } else {
    chatModel = options.defaultPaidChatModel;
  }

  const explicitFallbacks = readListEnv("TRASK_REWRITE_MODEL_FALLBACKS", env);
  let chatModelFallbacks: string[];
  if (explicitFallbacks.length > 0) {
    chatModelFallbacks = uniqueModels(explicitFallbacks);
  } else {
    const chain: string[] = [];
    if (preferFree) {
      chain.push(...TRASK_FREE_CHAT_MODELS);
    }
    if (hasDirectOpenAi || usesOpenRouter || usesProxy) {
      chain.push(...TRASK_PAID_CHAT_MODEL_FALLBACKS);
    }
    if (!preferFree && hasDirectOpenAi) {
      chain.unshift(options.defaultPaidChatModel);
    }
    chatModelFallbacks = uniqueModels(chain);
  }

  chatModelFallbacks = chatModelFallbacks.filter((id) => id !== chatModel);

  const openAiDefaultHeaders =
    usesOpenRouter || isOpenRouterBase(openAiBaseUrl) ? buildOpenRouterHeaders(env) : undefined;

  return {
    openAiApiKey,
    openAiBaseUrl,
    openAiDefaultHeaders,
    chatModel,
    chatModelFallbacks,
    providerHint,
  };
};
