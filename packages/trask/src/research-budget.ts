import type OpenAI from "openai";

import type { ResearchWizardRuntimeConfig } from "@openkotor/config";

/** Monotonic research budget from query start through gather + compose (REQ-C / R-LAT). */
export class ResearchBudget {
  readonly startedAt: number;
  readonly budgetMs: number;
  readonly composeCapMs: number;
  readonly minAttemptMs: number;

  constructor(
    config: Pick<ResearchWizardRuntimeConfig, "researchBudgetMs" | "composeTimeoutMs">,
    startedAt = Date.now(),
    minAttemptMs = 2000,
  ) {
    this.startedAt = startedAt;
    this.budgetMs = config.researchBudgetMs;
    this.composeCapMs = config.composeTimeoutMs;
    this.minAttemptMs = minAttemptMs;
  }

  get enabled(): boolean {
    return this.budgetMs > 0;
  }

  get deadlineMs(): number | undefined {
    return this.enabled ? this.startedAt + this.budgetMs : undefined;
  }

  remainingMs(now = Date.now()): number {
    if (!this.enabled) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, this.startedAt + this.budgetMs - now);
  }

  /** Per LLM attempt ceiling: min(composeCap, remaining budget), floored at minAttemptMs. */
  remainingComposeMs(now = Date.now()): number {
    if (!this.enabled) {
      return this.composeCapMs;
    }
    return Math.max(this.minAttemptMs, Math.min(this.composeCapMs, this.remainingMs(now)));
  }

  /** Gather subprocess wall clock capped by remaining budget when enabled. */
  gatherTimeoutMs(configGatherMs: number, now = Date.now()): number {
    if (!this.enabled) {
      return configGatherMs;
    }
    return Math.max(this.minAttemptMs, Math.min(configGatherMs, this.remainingMs(now)));
  }

  canAttemptCompose(minMs = 3000, now = Date.now()): boolean {
    return !this.enabled || this.remainingMs(now) >= minMs;
  }

  isExpired(now = Date.now()): boolean {
    return this.enabled && now >= this.startedAt + this.budgetMs;
  }
}

export type ComposeProviderClient = {
  readonly client: OpenAI;
  readonly providerId: string;
  readonly models: readonly string[];
};

export type BalancedComposeAttempt = {
  readonly client: OpenAI;
  readonly model: string;
  readonly providerId: string;
};

/** Round-robin provider models so Cloudflare still runs when HF has many fallbacks. */
export const buildBalancedComposeAttempts = (
  aiClients: readonly ComposeProviderClient[],
  preferredModel: string | undefined,
  maxAttempts: number,
): readonly BalancedComposeAttempt[] => {
  const entries = aiClients.map((entry, index) => {
    const preferred = index === 0 && preferredModel ? preferredModel : undefined;
    const models = preferred ? [...new Set([preferred, ...entry.models])] : [...entry.models];
    return { ...entry, models };
  });

  const attempts: BalancedComposeAttempt[] = [];
  let round = 0;
  while (attempts.length < maxAttempts) {
    let added = false;
    for (const entry of entries) {
      const model = entry.models[round];
      if (!model) {
        continue;
      }
      attempts.push({ client: entry.client, model, providerId: entry.providerId });
      added = true;
      if (attempts.length >= maxAttempts) {
        break;
      }
    }
    if (!added) {
      break;
    }
    round += 1;
  }
  return attempts;
};
