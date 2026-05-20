#!/usr/bin/env node
/**
 * Non-interactive: read Trask app id + public key from Developer Portal,
 * reset bot token, write repo-root .env (Trask section only).
 */
import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profileDir =
  process.env.DISCORD_PLAYWRIGHT_PROFILE?.trim() ||
  resolve(repoRoot, ".playwright-discord-profile");
const TRASK_APP_ID = process.env.TRASK_DISCORD_APP_ID?.trim() || "1305793207036022784";
const GUILD_ID = process.env.TRASK_DISCORD_GUILD_ID?.trim() || "1495218220632641628";
const CHANNEL_ID = process.env.TRASK_APPROVED_CHANNEL_ID?.trim() || "1497410480208216306";

async function loadPlaywright() {
  for (const pkg of ["playwright", "@playwright/test"]) {
    try {
      const m = await import(pkg);
      const mod = m.default ?? m;
      const c = mod.chromium ?? m.chromium;
      if (c?.launchPersistentContext) return c;
    } catch {
      /* next */
    }
  }
  throw new Error("Playwright not installed");
}

const readFields = async (page) =>
  page.evaluate(() => {
    const out = { appId: "", publicKey: "" };
    for (const input of document.querySelectorAll("input")) {
      const v = (input.value ?? "").trim();
      if (/^\d{17,20}$/.test(v)) out.appId = out.appId || v;
      if (/^[0-9a-f]{64}$/i.test(v)) out.publicKey = v;
    }
    return out;
  });

const main = async () => {
  mkdirSync(profileDir, { recursive: true });
  const chromium = await loadPlaywright();
  const headless = process.env.DISCORD_PLAYWRIGHT_HEADLESS !== "0";
  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless,
    args: ["--no-sandbox", "--window-size=1280,900"],
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  await page.goto(`https://discord.com/developers/applications/${TRASK_APP_ID}/information`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await sleep(3000);

  if (page.url().includes("/login")) {
    await ctx.close();
    throw new Error("Developer Portal not logged in — open discord.com/developers in browser and sign in first.");
  }

  let { appId, publicKey } = await readFields(page);
  appId = appId || TRASK_APP_ID;

  await page.goto(`https://discord.com/developers/applications/${TRASK_APP_ID}/bot`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await sleep(2500);

  const resetBtn = page.getByRole("button", { name: /reset token/i });
  if ((await resetBtn.count()) === 0) {
    await ctx.close();
    throw new Error("Reset Token button not found on Bot page.");
  }
  await resetBtn.first().click();
  await sleep(800);

  const confirm = page.getByRole("button", { name: /yes, do it/i });
  if ((await confirm.count()) > 0) {
    await confirm.first().click();
    await sleep(1500);
  }

  const mfa = page.getByPlaceholder(/6-digit authentication code/i);
  if ((await mfa.count()) > 0) {
    console.error(
      "Discord MFA required to reset the bot token. Complete the 6-digit code in the Playwright window (or Developer Portal), then re-run this script.",
    );
    await page.screenshot({ path: "/tmp/discord-bot-mfa-required.png", fullPage: true });
    await ctx.close();
    process.exit(2);
  }

  let botToken = "";
  for (let i = 0; i < 40; i++) {
    botToken = await page.evaluate(() => {
      for (const input of document.querySelectorAll("input")) {
        const v = (input.value ?? "").trim();
        if (v.length > 50 && v.includes(".") && /^[A-Za-z0-9._-]+$/.test(v)) return v;
      }
      return "";
    });
    if (botToken) break;
    await sleep(500);
  }

  if (!botToken) {
    await page.screenshot({ path: "/tmp/discord-bot-token-missing.png", fullPage: true });
    await ctx.close();
    throw new Error("Could not read bot token after reset. See /tmp/discord-bot-token-missing.png");
  }

  await ctx.close();

  if (!publicKey) {
    throw new Error("Public key not found on General Information page.");
  }

  const block = [
    "",
    "# ── Trask Discord (auto-generated) ──",
    `TRASK_DISCORD_APP_ID=${appId}`,
    `TRASK_DISCORD_PUBLIC_KEY=${publicKey}`,
    `TRASK_DISCORD_BOT_TOKEN=${botToken}`,
    `TRASK_DISCORD_GUILD_ID=${GUILD_ID}`,
    `TRASK_ALLOWED_GUILD_IDS=${GUILD_ID}`,
    `TRASK_APPROVED_CHANNEL_IDS=${CHANNEL_ID}`,
    `TRASK_SLASH_GUILD_IDS=${GUILD_ID}`,
    "",
  ].join("\n");

  const envPath = resolve(repoRoot, ".env");
  let existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  for (const key of [
    "TRASK_DISCORD_APP_ID",
    "TRASK_DISCORD_PUBLIC_KEY",
    "TRASK_DISCORD_BOT_TOKEN",
    "TRASK_DISCORD_GUILD_ID",
    "TRASK_ALLOWED_GUILD_IDS",
    "TRASK_APPROVED_CHANNEL_IDS",
    "TRASK_SLASH_GUILD_IDS",
  ]) {
    existing = existing.replace(new RegExp(`^${key}=.*$\\n?`, "gm"), "");
  }
  writeFileSync(envPath, `${existing.trimEnd()}\n${block}`);
  console.log(`Wrote Trask Discord credentials to ${envPath}`);
  console.log(`APP_ID=${appId} GUILD=${GUILD_ID} CHANNEL=${CHANNEL_ID}`);
};

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
