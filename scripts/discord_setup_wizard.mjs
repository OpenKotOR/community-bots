#!/usr/bin/env node
/**
 * Interactive Discord credentials wizard.
 *
 * Opens the correct Developer Portal URLs in xdg-open / the user's default
 * browser, then prompts for each credential and writes a validated .env file.
 *
 * Usage:  node scripts/discord_setup_wizard.mjs [--write]
 *
 * --write  Append to <repo>/.env automatically (defaults to ./‌.env)
 */
import { createInterface } from "node:readline";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot   = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const writeFlag  = process.argv.includes("--write");
const envPath    = resolve(repoRoot, ".env");

function hr(char = "─") { return char.repeat(62); }

function ask(rl, question) {
  return new Promise(res => rl.question(question, res));
}

function openUrl(url) {
  try { execSync(`xdg-open "${url}" 2>/dev/null`); } catch { /* ignore */ }
}

function validateSnowflake(s) { return /^\d{17,20}$/.test(s); }
function validateHex64(s)     { return /^[0-9a-f]{64}$/i.test(s); }
function validateBotToken(s)  {
  // Discord bot tokens look like: MTxxxx.Gxxxxx.xxxxx-xxx  (MTI format)
  return s.length > 50 && s.includes(".");
}

const BOTS = [
  {
    envPrefix : "TRASK",
    displayName: "Trask (KOTOR Q&A)",
    keywords   : ["trask", "holocron", "kotor"],
  },
  {
    envPrefix : "HK",
    displayName: "HK-86 (Discord utility bot)",
    keywords   : ["hk-86", "hk86", "hk"],
  },
  {
    envPrefix : "PAZAAK",
    displayName: "Pazaak (card game bot)",
    keywords   : ["pazaak"],
  },
];

async function main() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log("\n" + hr("═"));
  console.log("  Discord Bot Setup Wizard");
  console.log(hr("═"));
  console.log(`
This wizard will help you configure credentials for the three bots.
You need:  App ID  •  Public Key  •  Bot Token
for each of: Trask, HK-86, and Pazaak.

Where to find them — in YOUR regular browser:
  1. Go to https://discord.com/developers/applications
  2. Click the bot application
  3. "General Information" tab  →  copy App ID and Public Key
  4. "Bot" tab  →  click "Reset Token" → confirm → copy the token

NOTE: HK-86 and Pazaak deploy commands guild-scoped.
You will also be asked for your Discord Server (Guild) ID.
(Right-click your server icon → "Copy Server ID" with Developer Mode on)
`);

  const answer = await ask(rl, "  Open https://discord.com/developers/applications in your browser now? [Y/n] ");
  if (!answer.trim() || answer.trim().toLowerCase() !== "n") {
    openUrl("https://discord.com/developers/applications");
    console.log("  → Opened in your default browser.\n");
  }

  // Guild ID — shared across HK-86 and Pazaak
  console.log("\n" + hr());
  console.log("  Shared: Discord Server (Guild) ID");
  console.log(hr());
  console.log("  HK-86 and Pazaak deploy slash commands guild-scoped.");
  console.log("  Enable Developer Mode: Discord Settings → Advanced → Developer Mode");
  console.log("  Then: right-click your server icon → Copy Server ID\n");
  let guildId = "";
  while (true) {
    const raw = (await ask(rl, "  Guild / Server ID (17-20 digits, or Enter to skip): ")).trim();
    if (!raw) break;
    if (validateSnowflake(raw)) { guildId = raw; break; }
    console.log("  ⚠  Must be 17–20 digits. Try again.");
  }

  const envParts = {};

  for (const bot of BOTS) {
    console.log("\n" + hr());
    console.log(`  ${bot.displayName}  (${bot.envPrefix})`);
    console.log(hr());

    // App ID
    let appId = "";
    while (!validateSnowflake(appId)) {
      appId = (await ask(rl, `  App ID (17-20 digit number): `)).trim();
      if (!validateSnowflake(appId) && appId !== "") {
        console.log("  ⚠  Doesn't look like a Discord App ID (must be 17–20 digits). Try again.");
      }
    }

    // Public Key (optional but recommended)
    let pubKey = "";
    while (true) {
      const raw = (await ask(rl, `  Public Key (64-char hex, or Enter to skip): `)).trim();
      if (!raw) break;
      if (validateHex64(raw)) { pubKey = raw; break; }
      console.log("  ⚠  Should be 64 hex characters. Try again.");
    }

    // Bot Token
    let token = "";
    while (!validateBotToken(token)) {
      token = (await ask(rl, `  Bot Token (from the Bot tab → Reset Token): `)).trim();
      if (!validateBotToken(token) && token !== "") {
        console.log("  ⚠  Doesn't look right (should be 50+ chars with dots). Try again, or press Enter to skip.");
        const skip = await ask(rl, "  Skip this bot? [y/N] ");
        if (skip.trim().toLowerCase() === "y") { token = "SKIP"; break; }
      }
    }

    envParts[bot.envPrefix] = {
      appId,
      pubKey,
      token: token === "SKIP" ? "" : token,
    };
    console.log(`  ✓  ${bot.displayName} credentials saved.`);
  }

  // AI API key — required for Trask research synthesis
  console.log("\n" + hr());
  console.log("  AI API Key (for Trask Q&A research synthesis)");
  console.log(hr());
  console.log("  Trask needs an LLM to synthesize answers from KOTOR sources.");
  console.log("  Supported: OpenAI (https://platform.openai.com/api-keys)");
  console.log("             OpenRouter (https://openrouter.ai/keys) — access to many models");
  console.log("  Without a key, Trask will still find source links but cannot write full answers.\n");

  let openAiKey = "";
  let openRouterKey = "";
  const rawAiKey = (await ask(rl, "  OpenAI API key (sk-..., or Enter to skip): ")).trim();
  if (rawAiKey.startsWith("sk-")) {
    openAiKey = rawAiKey;
    console.log("  ✓  OpenAI API key saved.");
  } else if (rawAiKey) {
    console.log("  ⚠  Doesn't look like an OpenAI key (should start with sk-), skipping.");
  }

  if (!openAiKey) {
    const rawOrKey = (await ask(rl, "  OpenRouter API key (sk-or-..., or Enter to skip): ")).trim();
    if (rawOrKey.startsWith("sk-or-") || rawOrKey.startsWith("sk-")) {
      openRouterKey = rawOrKey;
      console.log("  ✓  OpenRouter API key saved.");
    } else if (rawOrKey) {
      console.log("  ⚠  Doesn't look like an OpenRouter key, skipping.");
    }
  }

  rl.close();

  // Build snippet
  const lines = ["\n# ── Discord Bot Credentials ──────────────────────────"];
  if (guildId) lines.push(`DISCORD_TARGET_GUILD_ID=${guildId}`);
  lines.push("");
  for (const [prefix, val] of Object.entries(envParts)) {
    if (val.appId)  lines.push(`${prefix}_DISCORD_APP_ID=${val.appId}`);
    if (val.pubKey) lines.push(`${prefix}_DISCORD_PUBLIC_KEY=${val.pubKey}`);
    if (val.token)  lines.push(`${prefix}_DISCORD_BOT_TOKEN=${val.token}`);
  }
  if (openAiKey || openRouterKey) {
    lines.push("\n# ── AI / LLM API Keys ────────────────────────────────");
    if (openAiKey)     lines.push(`OPENAI_API_KEY=${openAiKey}`);
    if (openRouterKey) lines.push(`OPENROUTER_API_KEY=${openRouterKey}`);
  }
  const snippet = lines.join("\n") + "\n";

  console.log("\n" + hr("═"));
  console.log("  Generated .env entries:");
  console.log(hr("═"));
  console.log(snippet);

  if (writeFlag) {
    const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    // Remove any existing DISCORD entries to avoid duplicates
    const stripped = existing
      .split("\n")
      .filter(l => !l.match(/^(DISCORD_TARGET_GUILD_ID|(TRASK|HK|PAZAAK)_DISCORD_(APP_ID|PUBLIC_KEY|BOT_TOKEN)|OPENAI_API_KEY|OPENROUTER_API_KEY)=/))
      .join("\n");
    writeFileSync(envPath, stripped.trimEnd() + snippet);
    console.log(`✅  Written to ${envPath}`);
  } else {
    console.log(`Run with --write to save automatically, or add the above to ${envPath}`);
  }

  // HK-86 reaction-role panels setup hint
  const panelsSrc = resolve(repoRoot, "apps/hk-bot/data-templates/reaction-role-panels.example.json");
  const panelsDst = resolve(repoRoot, "data/hk-bot/reaction-role-panels.json");
  const { existsSync: exists } = await import("node:fs");
  const { mkdirSync } = await import("node:fs");
  if (!exists(panelsDst)) {
    mkdirSync(resolve(repoRoot, "data/hk-bot"), { recursive: true });
    const { copyFileSync } = await import("node:fs");
    copyFileSync(panelsSrc, panelsDst);
    console.log("\n✅  Created data/hk-bot/reaction-role-panels.json from template.");
    console.log("   Edit it to add your channel ID, message ID, and emoji→role mappings.");
  }

  console.log(`
Next steps:
  pnpm dev:trask       # start Trask Q&A bot (uses OPENAI_API_KEY for answers)
  pnpm dev:hk          # start HK-86 bot (react-for-role)
  pnpm dev:pazaak      # start Pazaak card game bot
  pnpm dev:trask-http  # Trask HTTP server + Holocron web UI (port 4010)
  node scripts/discord_bots_smoke.mjs   # smoke-test command registration

For HK-86 reaction roles:
  Edit: data/hk-bot/reaction-role-panels.json
  (fill in channelId, messageId, and emoji/role mappings for your server)

For Trask web UI (Holocron):
  pnpm dev:holocron-web    # dev server at http://localhost:5173
  pnpm dev:trask-http      # API server at http://localhost:4010
`);
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
