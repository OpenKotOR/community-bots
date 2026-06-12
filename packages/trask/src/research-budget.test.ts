import test from "node:test";
import assert from "node:assert/strict";

import OpenAI from "openai";

import {
  buildBalancedComposeAttempts,
  ResearchBudget,
} from "./research-budget.js";

test("ResearchBudget remainingComposeMs caps by composeTimeoutMs and remaining budget", () => {
  const config = { researchBudgetMs: 30_000, composeTimeoutMs: 12_000 };
  const startedAt = 1_000_000;
  const budget = new ResearchBudget(config, startedAt);

  assert.equal(budget.remainingMs(startedAt + 25_000), 5000);
  assert.equal(budget.remainingComposeMs(startedAt + 25_000), 5000);
  assert.equal(budget.canAttemptCompose(3000, startedAt + 25_000), true);
  assert.equal(budget.canAttemptCompose(3000, startedAt + 29_000), false);
});

test("ResearchBudget gatherTimeoutMs respects remaining budget", () => {
  const config = { researchBudgetMs: 30_000, composeTimeoutMs: 12_000 };
  const startedAt = 1_000_000;
  const budget = new ResearchBudget(config, startedAt);

  assert.equal(budget.gatherTimeoutMs(90_000, startedAt), 30_000);
  assert.equal(budget.gatherTimeoutMs(90_000, startedAt + 28_000), 2000);
});

test("ResearchBudget disabled when researchBudgetMs is zero", () => {
  const config = { researchBudgetMs: 0, composeTimeoutMs: 12_000 };
  const budget = new ResearchBudget(config);

  assert.equal(budget.enabled, false);
  assert.equal(budget.deadlineMs, undefined);
  assert.equal(budget.remainingComposeMs(), 12_000);
  assert.equal(budget.gatherTimeoutMs(90_000), 90_000);
});

test("buildBalancedComposeAttempts interleaves providers before exhausting HF fallbacks", () => {
  const hf = {
    client: {} as OpenAI,
    providerId: "hf",
    models: ["hf1", "hf2", "hf3", "hf4", "hf5"],
  };
  const cf = {
    client: {} as OpenAI,
    providerId: "cf",
    models: ["cf1", "cf2"],
  };
  const attempts = buildBalancedComposeAttempts([hf, cf], undefined, 8);

  assert.deepEqual(
    attempts.map((entry) => `${entry.providerId}:${entry.model}`),
    ["hf:hf1", "cf:cf1", "hf:hf2", "cf:cf2", "hf:hf3", "hf:hf4", "hf:hf5"],
  );
});

test("buildBalancedComposeAttempts prefers model on first provider only", () => {
  const hf = {
    client: {} as OpenAI,
    providerId: "hf",
    models: ["hf-default", "hf2"],
  };
  const cf = {
    client: {} as OpenAI,
    providerId: "cf",
    models: ["cf1"],
  };
  const attempts = buildBalancedComposeAttempts([hf, cf], "preferred", 4);

  assert.equal(attempts[0]?.model, "preferred");
  assert.equal(attempts[1]?.providerId, "cf");
});
