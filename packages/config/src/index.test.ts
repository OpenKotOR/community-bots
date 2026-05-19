import test from "node:test";
import assert from "node:assert/strict";

import {
  loadSharedAiConfig,
  loadResearchWizardRuntimeConfig,
  loadTraskHttpServerConfig,
  loadHkBotConfig,
  loadPazaakBotConfig,
  loadPazaakOpsPolicyForNode,
} from "./index.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal env that satisfies required Discord fields for a given prefix. */
const discordEnv = (prefix: string) => ({
  [`${prefix}_DISCORD_APP_ID`]: "app-id-1234",
  [`${prefix}_DISCORD_PUBLIC_KEY`]: "pub-key-5678",
  [`${prefix}_DISCORD_BOT_TOKEN`]: "bot-token-9abc",
});

// ---------------------------------------------------------------------------
// loadSharedAiConfig — key resolution and fallback
// ---------------------------------------------------------------------------

test("loadSharedAiConfig reads OPENAI_API_KEY", () => {
  const cfg = loadSharedAiConfig({ OPENAI_API_KEY: "sk-test-openai" });
  assert.equal(cfg.openAiApiKey, "sk-test-openai");
});

test("loadSharedAiConfig falls back to OPENROUTER_API_KEY when OPENAI_API_KEY is absent", () => {
  const cfg = loadSharedAiConfig({ OPENROUTER_API_KEY: "sk-or-test" });
  assert.equal(cfg.openAiApiKey, "sk-or-test");
});

test("loadSharedAiConfig OPENAI_API_KEY takes precedence over OPENROUTER_API_KEY", () => {
  const cfg = loadSharedAiConfig({ OPENAI_API_KEY: "openai-key", OPENROUTER_API_KEY: "or-key" });
  assert.equal(cfg.openAiApiKey, "openai-key");
});

test("loadSharedAiConfig sets openAiApiKey to undefined when neither key is present", () => {
  const cfg = loadSharedAiConfig({});
  assert.equal(cfg.openAiApiKey, undefined);
});

test("loadSharedAiConfig uses default chat model when OPENAI_CHAT_MODEL is absent", () => {
  const cfg = loadSharedAiConfig({});
  assert.ok(cfg.chatModel.length > 0, "chatModel should have a non-empty default");
});

test("loadSharedAiConfig respects OPENAI_CHAT_MODEL override", () => {
  const cfg = loadSharedAiConfig({ OPENAI_CHAT_MODEL: "gpt-4o" });
  assert.equal(cfg.chatModel, "gpt-4o");
});

test("loadSharedAiConfig parses TRASK_REWRITE_MODEL_FALLBACKS as comma list", () => {
  const cfg = loadSharedAiConfig({ TRASK_REWRITE_MODEL_FALLBACKS: "model-a,model-b, model-c" });
  assert.deepEqual([...cfg.chatModelFallbacks], ["model-a", "model-b", "model-c"]);
});

test("loadSharedAiConfig returns empty fallbacks when TRASK_REWRITE_MODEL_FALLBACKS is unset", () => {
  const cfg = loadSharedAiConfig({});
  assert.deepEqual([...cfg.chatModelFallbacks], []);
});

test("loadSharedAiConfig injects OPENROUTER headers when present", () => {
  const cfg = loadSharedAiConfig({
    OPENROUTER_HTTP_REFERER: "https://myapp.example",
    OPENROUTER_APP_TITLE: "MyApp",
  });
  assert.ok(cfg.openAiDefaultHeaders);
  assert.equal(cfg.openAiDefaultHeaders?.["HTTP-Referer"], "https://myapp.example");
  assert.equal(cfg.openAiDefaultHeaders?.["X-Title"], "MyApp");
});

test("loadSharedAiConfig returns undefined headers when no OpenRouter vars are set", () => {
  const cfg = loadSharedAiConfig({});
  assert.equal(cfg.openAiDefaultHeaders, undefined);
});

// ---------------------------------------------------------------------------
// loadResearchWizardRuntimeConfig — timeout and script path
// ---------------------------------------------------------------------------

test("loadResearchWizardRuntimeConfig defaults timeout to 900000 ms when TRASK_RESEARCHWIZARD_TIMEOUT_MS is absent", () => {
  const cfg = loadResearchWizardRuntimeConfig({});
  assert.equal(cfg.timeoutMs, 900000);
});

test("loadResearchWizardRuntimeConfig respects TRASK_RESEARCHWIZARD_TIMEOUT_MS override", () => {
  const cfg = loadResearchWizardRuntimeConfig({ TRASK_RESEARCHWIZARD_TIMEOUT_MS: "120000" });
  assert.equal(cfg.timeoutMs, 120000);
});

test("loadResearchWizardRuntimeConfig resolves repoRoot and pythonExecutable", () => {
  const cfg = loadResearchWizardRuntimeConfig({});
  assert.ok(cfg.repoRoot.length > 0);
  assert.ok(cfg.pythonExecutable.length > 0);
  assert.equal(cfg.headlessScriptPath, undefined);
});

test("loadResearchWizardRuntimeConfig respects TRASK_WEB_RESEARCH_PYTHON override", () => {
  const cfg = loadResearchWizardRuntimeConfig({ TRASK_WEB_RESEARCH_PYTHON: "/custom/python" });
  assert.equal(cfg.pythonExecutable, "/custom/python");
});

test("loadResearchWizardRuntimeConfig resolves TRASK_RESEARCH_BACKEND_URL", () => {
  const cfg = loadResearchWizardRuntimeConfig({ TRASK_RESEARCH_BACKEND_URL: "http://127.0.0.1:3002" });
  assert.equal(cfg.backendUrl, "http://127.0.0.1:3002");
});

// ---------------------------------------------------------------------------
// loadTraskHttpServerConfig — anonymous access rule
// ---------------------------------------------------------------------------

test("webAllowAnonymous is true when no API key is set", () => {
  const cfg = loadTraskHttpServerConfig({ TRASK_HTTP_PORT: "4010" });
  assert.equal(cfg.webAllowAnonymous, true);
});

test("webAllowAnonymous is false when TRASK_WEB_API_KEY is set", () => {
  const cfg = loadTraskHttpServerConfig({ TRASK_WEB_API_KEY: "secret-key-xyz" });
  assert.equal(cfg.webAllowAnonymous, false);
});

test("webAllowAnonymous respects explicit TRASK_WEB_ALLOW_ANONYMOUS=0 override", () => {
  // Even without an API key, explicit opt-out should be respected.
  const cfg = loadTraskHttpServerConfig({ TRASK_WEB_ALLOW_ANONYMOUS: "0" });
  assert.equal(cfg.webAllowAnonymous, false);
});

test("webAllowAnonymous respects explicit TRASK_WEB_ALLOW_ANONYMOUS=1 override even with key set", () => {
  const cfg = loadTraskHttpServerConfig({ TRASK_WEB_API_KEY: "key", TRASK_WEB_ALLOW_ANONYMOUS: "1" });
  assert.equal(cfg.webAllowAnonymous, true);
});

test("loadTraskHttpServerConfig defaults port to 4010", () => {
  const cfg = loadTraskHttpServerConfig({});
  assert.equal(cfg.port, 4010);
});

test("loadTraskHttpServerConfig respects TRASK_HTTP_PORT override", () => {
  const cfg = loadTraskHttpServerConfig({ TRASK_HTTP_PORT: "5050" });
  assert.equal(cfg.port, 5050);
});

test("loadTraskHttpServerConfig defaults webDefaultUserId", () => {
  const cfg = loadTraskHttpServerConfig({});
  assert.ok(cfg.webDefaultUserId.length > 0);
});

// ---------------------------------------------------------------------------
// loadHkBotConfig — LLM settings
// ---------------------------------------------------------------------------

test("loadHkBotConfig llm.enabled defaults to false", () => {
  const cfg = loadHkBotConfig({ ...discordEnv("HK") });
  assert.equal(cfg.llm.enabled, false);
});

test("loadHkBotConfig enables LLM when HK_LLM_ENABLED=true", () => {
  const cfg = loadHkBotConfig({ ...discordEnv("HK"), HK_LLM_ENABLED: "true" });
  assert.equal(cfg.llm.enabled, true);
});

test("loadHkBotConfig LLM timeout defaults to 6000 ms", () => {
  const cfg = loadHkBotConfig({ ...discordEnv("HK") });
  assert.equal(cfg.llm.timeoutMs, 6000);
});

test("loadHkBotConfig defaults dataDir", () => {
  const cfg = loadHkBotConfig({ ...discordEnv("HK") });
  assert.ok(cfg.dataDir.length > 0);
});

test("loadHkBotConfig respects HK_DATA_DIR override", () => {
  const cfg = loadHkBotConfig({ ...discordEnv("HK"), HK_DATA_DIR: "/custom/hk-data" });
  assert.equal(cfg.dataDir, "/custom/hk-data");
});

test("loadHkBotConfig throws when required HK_DISCORD_BOT_TOKEN is missing", () => {
  assert.throws(
    () => loadHkBotConfig({}),
    /HK_DISCORD_BOT_TOKEN|Missing required/,
  );
});

// ---------------------------------------------------------------------------
// loadPazaakBotConfig — credits and timers
// ---------------------------------------------------------------------------

test("loadPazaakBotConfig defaults startingCredits to 1000", () => {
  const cfg = loadPazaakBotConfig({ ...discordEnv("PAZAAK") });
  assert.equal(cfg.startingCredits, 1000);
});

test("loadPazaakBotConfig respects PAZAAK_STARTING_CREDITS override", () => {
  const cfg = loadPazaakBotConfig({ ...discordEnv("PAZAAK"), PAZAAK_STARTING_CREDITS: "500" });
  assert.equal(cfg.startingCredits, 500);
});

test("loadPazaakBotConfig defaults dailyBonusCredits to 200", () => {
  const cfg = loadPazaakBotConfig({ ...discordEnv("PAZAAK") });
  assert.equal(cfg.dailyBonusCredits, 200);
});

test("loadPazaakBotConfig defaults apiPort to 4001", () => {
  const cfg = loadPazaakBotConfig({ ...discordEnv("PAZAAK") });
  assert.equal(cfg.apiPort, 4001);
});

test("loadPazaakBotConfig allowDevAuth defaults to false", () => {
  const cfg = loadPazaakBotConfig({ ...discordEnv("PAZAAK") });
  assert.equal(cfg.allowDevAuth, false);
});

test("loadPazaakBotConfig enables allowDevAuth via PAZAAK_ALLOW_DEV_AUTH=1", () => {
  const cfg = loadPazaakBotConfig({ ...discordEnv("PAZAAK"), PAZAAK_ALLOW_DEV_AUTH: "1" });
  assert.equal(cfg.allowDevAuth, true);
});

// ---------------------------------------------------------------------------
// loadPazaakOpsPolicyForNode — legacy env var shims
// ---------------------------------------------------------------------------

test("loadPazaakOpsPolicyForNode applies legacy PAZAAK_TURN_TIMER_SECONDS", () => {
  const policy = loadPazaakOpsPolicyForNode({ PAZAAK_TURN_TIMER_SECONDS: "90" });
  assert.equal(policy.timers.turnTimerSeconds, 90);
});

test("loadPazaakOpsPolicyForNode applies PAZAAK_POLICY__ prefix overrides", () => {
  const policy = loadPazaakOpsPolicyForNode({ PAZAAK_POLICY__TIMERS__TURN_TIMER_SECONDS: "120" });
  assert.equal(policy.timers.turnTimerSeconds, 120);
});

test("loadPazaakOpsPolicyForNode returns valid defaults when no env vars set", () => {
  const policy = loadPazaakOpsPolicyForNode({});
  assert.ok(policy.timers.turnTimerSeconds > 0);
  assert.ok(policy.timers.turnTimeoutMs > 0);
  assert.ok(policy.matchmaking.tickMs > 0);
});
