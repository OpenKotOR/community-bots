import assert from "node:assert/strict";
import test from "node:test";

import { filterFreeChatModels, parseFallbackModelOutput } from "./free-models.js";

void test("filterFreeChatModels keeps explicit free model identifiers only", () => {
  const models = filterFreeChatModels([
    "openrouter/auto",
    "meta-llama/llama-3.2-3b-instruct:free",
    "  qwen/qwen3-coder:free  ",
    "openai/gpt-4o-mini",
    "google/gemini-flash-lite-free",
  ]);

  assert.deepEqual(models, [
    "meta-llama/llama-3.2-3b-instruct:free",
    "qwen/qwen3-coder:free",
    "google/gemini-flash-lite-free",
  ]);
});

void test("filterFreeChatModels deduplicates while preserving order", () => {
  assert.deepEqual(
    filterFreeChatModels(["a/free-model", "a/free-model", "b/model:free"]),
    ["a/free-model", "b/model:free"],
  );
});

void test("parseFallbackModelOutput reads JSON array output", () => {
  assert.deepEqual(
    parseFallbackModelOutput(`["model-a:free", "model-b-free"]`),
    ["model-a:free", "model-b-free"],
  );
});

void test("parseFallbackModelOutput returns empty list for invalid output", () => {
  assert.deepEqual(parseFallbackModelOutput("FAST_LLM=openrouter/auto"), []);
});
