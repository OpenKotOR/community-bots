import test from "node:test";
import assert from "node:assert/strict";

import {
  loadSharedAiConfig,
  loadResearchWizardRuntimeConfig,
  loadWebResearchRuntimeConfig,
  resolveResearchComposeMode,
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

test("loadSharedAiConfig free profile uses OpenRouter free model when only OPENROUTER_API_KEY is set", () => {
  const cfg = loadSharedAiConfig({ OPENROUTER_API_KEY: "sk-or-test" });
  assert.equal(cfg.openAiBaseUrl, "https://openrouter.ai/api/v1");
  assert.equal(cfg.chatModel, "openrouter/free");
  assert.ok(cfg.chatModelFallbacks.includes("openrouter/auto"));
});

test("loadSharedAiConfig free profile lists quality-first fallbacks before vendor scan order", () => {
  const cfg = loadSharedAiConfig({ OPENROUTER_API_KEY: "sk-or-test" });
  assert.equal(cfg.chatModelFallbacks[0], "meta-llama/llama-3.3-70b-instruct:free");
  assert.ok(cfg.chatModelFallbacks.includes("qwen/qwen3-coder:free"));
  assert.equal(cfg.chatModelFallbacks.at(-1), "openrouter/auto");
  assert.ok(cfg.chatModelFallbacks.length <= 7, "primary + fallbacks must fit MAX_REWRITE_ATTEMPTS=8");
});

test("loadSharedAiConfig wires LiteLLM proxy URL and placeholder key", () => {
  const cfg = loadSharedAiConfig({ LITELLM_PROXY_URL: "http://127.0.0.1:4000" });
  assert.equal(cfg.openAiBaseUrl, "http://127.0.0.1:4000/v1");
  assert.equal(cfg.openAiApiKey, "sk-local");
  assert.equal(cfg.chatModel, "trask-research");
});

test("loadSharedAiConfig prefers explicit OPENAI_BASE_URL over proxy URL", () => {
  const cfg = loadSharedAiConfig({
    LITELLM_PROXY_URL: "http://127.0.0.1:4000",
    OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
    OPENROUTER_API_KEY: "sk-or-test",
  });
  assert.equal(cfg.openAiBaseUrl, "https://openrouter.ai/api/v1");
});

test("loadSharedAiConfig paid profile uses LiteLLM paid alias when proxy is set", () => {
  const cfg = loadSharedAiConfig({
    LITELLM_PROXY_URL: "http://127.0.0.1:4000",
    TRASK_LLM_PROFILE: "paid",
  });
  assert.equal(cfg.chatModel, "trask-research-paid-only");
});

test("loadSharedAiConfig paid profile prefers paid OpenRouter model", () => {
  const cfg = loadSharedAiConfig({
    OPENROUTER_API_KEY: "sk-or-test",
    TRASK_LLM_PROFILE: "paid",
  });
  assert.equal(cfg.chatModel, "openrouter/auto");
});

// ---------------------------------------------------------------------------
// loadResearchWizardRuntimeConfig — timeout and script path
// ---------------------------------------------------------------------------

test("loadResearchWizardRuntimeConfig defaults timeout to 900000 ms when TRASK_RESEARCH_TIMEOUT_MS is absent", () => {
  const cfg = loadResearchWizardRuntimeConfig({});
  assert.equal(cfg.timeoutMs, 900000);
});

test("loadResearchWizardRuntimeConfig respects TRASK_RESEARCHWIZARD_TIMEOUT_MS override", () => {
  const cfg = loadResearchWizardRuntimeConfig({ TRASK_RESEARCHWIZARD_TIMEOUT_MS: "120000" });
  assert.equal(cfg.timeoutMs, 120000);
});

test("loadResearchWizardRuntimeConfig tiered gather and compose timeouts (budget disabled)", () => {
  // Disable the soft budget to inspect the raw tiered ceilings.
  const defaults = loadResearchWizardRuntimeConfig({ TRASK_RESEARCH_BUDGET_MS: "0" });
  assert.equal(defaults.gatherTimeoutMs, 120_000);
  assert.equal(defaults.composeTimeoutMs, 60_000);

  const cfg = loadResearchWizardRuntimeConfig({
    TRASK_RESEARCH_BUDGET_MS: "0",
    TRASK_RESEARCH_GATHER_MS: "85000",
    TRASK_RESEARCH_COMPOSE_MS: "45000",
  });
  assert.equal(cfg.gatherTimeoutMs, 85_000);
  assert.equal(cfg.composeTimeoutMs, 45_000);
});

test("loadResearchWizardRuntimeConfig defaults research budget to 30s and clamps both phases", () => {
  const cfg = loadResearchWizardRuntimeConfig({});
  assert.equal(cfg.researchBudgetMs, 30_000);
  // Default gather (120s) and compose (60s) are clamped down to the 30s budget.
  assert.equal(cfg.gatherTimeoutMs, 30_000);
  assert.equal(cfg.composeTimeoutMs, 30_000);
});

test("loadResearchWizardRuntimeConfig budget never raises phase ceilings above their own value", () => {
  const cfg = loadResearchWizardRuntimeConfig({
    TRASK_RESEARCH_BUDGET_MS: "30000",
    TRASK_RESEARCH_GATHER_MS: "12000",
    TRASK_RESEARCH_COMPOSE_MS: "8000",
  });
  assert.equal(cfg.gatherTimeoutMs, 12_000);
  assert.equal(cfg.composeTimeoutMs, 8_000);
});

test("loadResearchWizardRuntimeConfig respects a custom research budget override", () => {
  const cfg = loadResearchWizardRuntimeConfig({ TRASK_RESEARCH_BUDGET_MS: "20000" });
  assert.equal(cfg.researchBudgetMs, 20_000);
  assert.equal(cfg.gatherTimeoutMs, 20_000);
  assert.equal(cfg.composeTimeoutMs, 20_000);
});

test("loadResearchWizardRuntimeConfig sets researchScriptPath to undefined when TRASK_WEB_RESEARCH_SCRIPT is absent", () => {
  const cfg = loadResearchWizardRuntimeConfig({});
  assert.equal(cfg.researchScriptPath, undefined);
});

test("loadResearchWizardRuntimeConfig resolves an explicit research script path", () => {
  const cfg = loadResearchWizardRuntimeConfig({ TRASK_WEB_RESEARCH_SCRIPT: "/tmp/my_script.py" });
  assert.ok(cfg.researchScriptPath?.endsWith("my_script.py"));
});

test("loadResearchWizardRuntimeConfig defaults indexer base URL", () => {
  const cfg = loadResearchWizardRuntimeConfig({});
  assert.equal(cfg.indexerBaseUrl, "http://127.0.0.1:8787");
});

test("loadResearchWizardRuntimeConfig respects TRASK_INDEXER_BASE_URL", () => {
  const cfg = loadResearchWizardRuntimeConfig({ TRASK_INDEXER_BASE_URL: "http://127.0.0.1:9999" });
  assert.equal(cfg.indexerBaseUrl, "http://127.0.0.1:9999");
});

test("loadResearchWizardRuntimeConfig defaults grounded compose on and composeMode grounded", () => {
  const cfg = loadResearchWizardRuntimeConfig({});
  assert.equal(cfg.groundedComposeEnabled, true);
  assert.equal(cfg.composeMode, "grounded");
});

test("loadResearchWizardRuntimeConfig enables rewrite compose mode when TRASK_RESEARCH_COMPOSE_MODE=rewrite", () => {
  const cfg = loadResearchWizardRuntimeConfig({ TRASK_RESEARCH_COMPOSE_MODE: "rewrite" });
  assert.equal(cfg.composeMode, "rewrite");
  assert.equal(cfg.groundedComposeEnabled, false);
});

test("loadResearchWizardRuntimeConfig disables grounded compose when TRASK_GROUNDED_COMPOSE=0", () => {
  const cfg = loadResearchWizardRuntimeConfig({ TRASK_GROUNDED_COMPOSE: "0" });
  assert.equal(cfg.groundedComposeEnabled, false);
});

test("loadResearchWizardRuntimeConfig throws on invalid TRASK_GROUNDED_COMPOSE", () => {
  assert.throws(
    () => loadResearchWizardRuntimeConfig({ TRASK_GROUNDED_COMPOSE: "maybe" }),
    /Invalid boolean value for environment variable TRASK_GROUNDED_COMPOSE/,
  );
});

test("resolveResearchComposeMode warns and defaults on unrecognized values", () => {
  const warnings: string[] = [];
  assert.equal(
    resolveResearchComposeMode("rewite", (message) => {
      warnings.push(message);
    }),
    "grounded",
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /Unrecognized TRASK_RESEARCH_COMPOSE_MODE/);
});

test("resolveResearchComposeMode accepts explicit grounded", () => {
  assert.equal(resolveResearchComposeMode("grounded", () => {}), "grounded");
});

test("resolveResearchComposeMode warns on whitespace-only values", () => {
  const warnings: string[] = [];
  assert.equal(
    resolveResearchComposeMode("   ", (message) => {
      warnings.push(message);
    }),
    "grounded",
  );
  assert.equal(warnings.length, 1);
});

test("loadWebResearchRuntimeConfig inherits composeMode from wizard env", () => {
  const cfg = loadWebResearchRuntimeConfig({});
  assert.equal(cfg.composeMode, "grounded");
  assert.equal(cfg.groundedComposeEnabled, true);
});

test("loadWebResearchRuntimeConfig inherits rewrite compose mode when TRASK_RESEARCH_COMPOSE_MODE=rewrite", () => {
  const cfg = loadWebResearchRuntimeConfig({ TRASK_RESEARCH_COMPOSE_MODE: "rewrite" });
  assert.equal(cfg.composeMode, "rewrite");
  assert.equal(cfg.groundedComposeEnabled, false);
});

test("loadResearchWizardRuntimeConfig falls back to 'python' when no research venv is present", () => {
  const cfg = loadResearchWizardRuntimeConfig({ TRASK_REPO_ROOT: "/nonexistent/path/that/does/not/exist" });
  assert.ok(typeof cfg.pythonExecutable === "string");
  assert.ok(cfg.pythonExecutable.length > 0);
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
