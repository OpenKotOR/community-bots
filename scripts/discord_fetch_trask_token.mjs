#!/usr/bin/env node
/**
 * Fetch Trask bot credentials from Discord Developer Portal (persistent login).
 * Resets bot token and writes repo-root .env when --write is passed.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profileDir = resolve(repoRoot, ".playwright-discord-profile");
const writeFlag = process.argv.includes("--write");
const APP_ID = "1305793207036022784";
const GUILD_ID = "1495218220632641628";
const CHANNEL_ID = "1497410480208216306";
const PUBLIC_KEY = "6d166dd8329b951492f4755e9163bfa4ea0effeb246497dc2816a4374bff2cfd";

async function loadPlaywright() {
  for (const pkg of ["playwright", "@playwright/test"]) {
    try {
      const m = await import(pkg);
      const mod = m.default ?? m;
      const c = mod.chromium ?? m.chromium;
      if (c?.launchPersistentContext) return c;
    } catch {
      /* try next */
    }
  }
  throw new Error("Playwright not found");
}

const readFieldValues = async (page) =>
  page.evaluate(() => {
    const out = { appId: "", publicKey: "", token: "" };
    for (const input of document.querySelectorAll("input")) {
      const val = (input.value ?? "").trim();
      if (/^\d{17,20}$/.test(val) && !out.appId) out.appId = val;
      if (/^[0-9a-f]{64}$/i.test(val) && !out.publicKey) out.publicKey = val;
      if (val.length > 50 && val.includes(".") && !out.token) out.token = val;
    }
    return out;
  });

const main = async () => {
  mkdirSync(profileDir, { recursive: true });
  const chromium = await loadPlaywright();
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: ["--no-sandbox", "--window-size=1280,900"],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  await page.goto(`https://discord.com/developers/applications/${APP_ID}/bot`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await sleep(3000);

  if (page.url().includes("login")) {
    console.error("Not logged in to Discord Developer Portal. Log in in the opened browser window and re-run.");
    await sleep(120_000);
    await ctx.close();
    process.exit(1);
  }

  let fields = await readFieldValues(page);
  if (!fields.token) {
    const resetBtn = page.getByRole("button", { name: /reset token/i });
    if ((await resetBtn.count()) > 0) {
      await resetBtn.first().click();
      await sleep(800);
      const confirm = page.getByRole("button", { name: /yes, do it/i });
      if ((await confirm.count()) > 0) {
        await confirm.first().click();
        await sleep(2500);
      }
      fields = await readFieldValues(page);
    }
  }

  const token = fields.token?.trim() ?? "";
  if (!token) {
    await page.screenshot({ path: "/tmp/discord-trask-bot-no-token.png", fullPage: true });
    console.error("Could not read bot token. Screenshot: /tmp/discord-trask-bot-no-token.png");
    await ctx.close();
    process.exit(1);
  }

  const envLines = [
    "# Trask Discord bot — auto-generated",
    `TRASK_DISCORD_APP_ID=${APP_ID}`,
    `TRASK_DISCORD_PUBLIC_KEY=${PUBLIC_KEY}`,
    `TRASK_DISCORD_BOT_TOKEN=${token}`,
    `TRASK_DISCORD_GUILD_ID=${GUILD_ID}`,
    `TRASK_SLASH_GUILD_IDS=${GUILD_ID}`,
    `TRASK_ALLOWED_GUILD_IDS=${GUILD_ID}`,
    `TRASK_APPROVED_CHANNEL_IDS=${CHANNEL_ID}`,
    "INGEST_STATE_DIR=data/ingest-worker",
    "TRASK_QUERY_DATA_DIR=data/trask-bot",
    "TRASK_RESEARCHWIZARD_TIMEOUT_MS=120000",
    "TRASK_WEB_RESEARCH_PYTHON=.venv-trask-research/bin/python",
    "",
  ].join("\n");

  if (writeFlag) {
    const envPath = resolve(repoRoot, ".env");
    const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    const merged = existing.includes("TRASK_DISCORD_BOT_TOKEN=")
      ? existing.replace(/^TRASK_DISCORD_BOT_TOKEN=.*$/m, `TRASK_DISCORD_BOT_TOKEN=${token}`)
      : `${existing.trimEnd()}\n\n${envLines}`;
    writeFileSync(envPath, merged.endsWith("\n") ? merged : `${merged}\n`, { mode: 0o600 });
    console.log(`Wrote ${envPath} (token length ${token.length})`);
  } else {
    console.log("Token acquired (not written). Re-run with --write to save .env");
  }

  await ctx.close();
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
