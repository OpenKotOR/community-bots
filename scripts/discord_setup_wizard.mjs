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
`);

  const answer = await ask(rl, "  Open https://discord.com/developers/applications in your browser now? [Y/n] ");
  if (!answer.trim() || answer.trim().toLowerCase() !== "n") {
    openUrl("https://discord.com/developers/applications");
    console.log("  → Opened in your default browser.\n");
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

  rl.close();

  // Build snippet
  const lines = ["\n# ── Discord Bot Credentials ──────────────────────────"];
  for (const [prefix, val] of Object.entries(envParts)) {
    if (val.appId)  lines.push(`${prefix}_DISCORD_APP_ID=${val.appId}`);
    if (val.pubKey) lines.push(`${prefix}_DISCORD_PUBLIC_KEY=${val.pubKey}`);
    if (val.token)  lines.push(`${prefix}_DISCORD_BOT_TOKEN=${val.token}`);
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
      .filter(l => !l.match(/^(TRASK|HK|PAZAAK)_DISCORD_(APP_ID|PUBLIC_KEY|BOT_TOKEN)=/))
      .join("\n");
    writeFileSync(envPath, stripped.trimEnd() + snippet);
    console.log(`✅  Written to ${envPath}`);
  } else {
    console.log(`Run with --write to save automatically, or add the above to ${envPath}`);
  }

  console.log(`
Next steps:
  pnpm dev:trask       # start Trask bot
  pnpm dev:hk          # start HK-86 bot
  pnpm dev:pazaak      # start Pazaak bot
  node scripts/discord_bots_smoke.mjs   # smoke-test command registration
`);
}

main().catch(e => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
