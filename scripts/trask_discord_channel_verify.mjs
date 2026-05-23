#!/usr/bin/env node
/**
 * List guild text channels and compare against TRASK_APPROVED_CHANNEL_IDS.
 * Requires TRASK_DISCORD_BOT_TOKEN and TRASK_ALLOWED_GUILD_IDS (or TRASK_DISCORD_GUILD_ID).
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const loadEnvFile = (path) => {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
};

loadEnvFile(resolve(process.cwd(), ".env"));

const token = process.env.TRASK_DISCORD_BOT_TOKEN?.trim();
const guildIds = (
  process.env.TRASK_ALLOWED_GUILD_IDS
  || process.env.TRASK_DISCORD_GUILD_ID
  || ""
)
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

const approved = (process.env.TRASK_APPROVED_CHANNEL_IDS || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);

if (!token) {
  console.error("Missing TRASK_DISCORD_BOT_TOKEN");
  process.exit(1);
}

if (guildIds.length === 0) {
  console.error("Missing TRASK_ALLOWED_GUILD_IDS or TRASK_DISCORD_GUILD_ID");
  process.exit(1);
}

const headers = { Authorization: `Bot ${token}` };

for (const guildId of guildIds) {
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/channels`, { headers });
  if (!response.ok) {
    console.error(`Failed to list channels for guild ${guildId}: ${response.status} ${await response.text()}`);
    process.exit(1);
  }

  const channels = await response.json();
  const textChannels = channels.filter((ch) => ch.type === 0);

  console.log(`\nGuild ${guildId} — ${textChannels.length} text channels:`);
  for (const ch of textChannels.sort((a, b) => a.name.localeCompare(b.name))) {
    const marker = approved.includes(ch.id) ? "✓ approved" : "";
    console.log(`  #${ch.name}  ${ch.id}  ${marker}`);
  }
}

if (approved.length === 0) {
  console.log("\nTRASK_APPROVED_CHANNEL_IDS is empty — /ask allowed in all channels when guild matches.");
} else {
  const missing = approved.filter((id) => {
    return !guildIds.some(() => true);
  });
  console.log(`\nConfigured approved channel IDs: ${approved.join(", ")}`);
  if (missing.length > 0) {
    console.warn("Some approved IDs were not validated against the listing above — confirm they match #discord-bot-testing.");
  }
}
