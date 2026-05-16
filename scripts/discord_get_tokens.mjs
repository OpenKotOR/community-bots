#!/usr/bin/env node
/**
 * Opens Discord Developer Portal in a persistent Chromium profile.
 * Login session is saved so you only log in once.
 * Reads all application IDs, walks each app for App ID + Public Key,
 * prompts you (in this terminal) to paste the bot token for each,
 * and writes a ready .env snippet.
 *
 * Usage:
 *   node scripts/discord_get_tokens.mjs [--write] [--timeout-ms=180000]
 *
 *   --write         Append credentials to <repo>/.env automatically
 *   --timeout-ms=N  How long to wait for login (default 180000 = 3 min)
 */
import { setTimeout as sleep } from "node:timers/promises";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "node:readline/promises";
import { createInterface } from "node:readline";

const repoRoot   = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const writeFlag  = process.argv.includes("--write");
const timeoutArg = process.argv.find(a => a.startsWith("--timeout-ms="));
const loginMs    = timeoutArg ? parseInt(timeoutArg.split("=")[1], 10) : 180_000;
const profileDir = resolve(repoRoot, ".playwright-discord-profile");

async function loadPlaywright() {
  for (const pkg of ["playwright", "@playwright/test"]) {
    try {
      const m   = await import(pkg);
      const mod = m.default ?? m;
      const c   = mod.chromium ?? m.chromium;
      if (c?.launchPersistentContext) return c;
    } catch { /* try next */ }
  }
  throw new Error("Playwright not found. Run: npx playwright install chromium");
}

const BOTS = [
  { envPrefix: "TRASK",  keywords: ["trask", "holocron", "kotor", "openkotor"] },
  { envPrefix: "HK",     keywords: ["hk-86", "hk86", "hk bot"] },
  { envPrefix: "PAZAAK", keywords: ["pazaak", "cardworld"] },
];

function printSeparator() { console.log("─".repeat(60)); }

async function waitForApplicationsPage(page) {
  const deadline = Date.now() + loginMs;
  process.stdout.write(`\n⏳  Waiting up to ${loginMs / 1000}s for Discord login…\n`);
  process.stdout.write("    → A Chromium window opened. Log into Discord there.\n\n");

  while (Date.now() < deadline) {
    const url = page.url();

    // 1. Handle "Welcome to the Developer Portal" modal — click its Log In button
    const welcomeModal = page.locator('[class*="modal"] button:has-text("Log In"), [class*="welcome"] button:has-text("Log In"), [role="dialog"] button:has-text("Log In")');
    try {
      if (await welcomeModal.isVisible({ timeout: 500 })) {
        process.stdout.write("\n   → Clicking 'Log In' in welcome modal…\n");
        await welcomeModal.first().click();
        await sleep(2000);
        continue;
      }
    } catch { /* ignore */ }

    // 2. We're on Discord's login page — user needs to sign in
    if (url.includes("discord.com/login") || url.includes("discord.com/oauth2")) {
      process.stdout.write("   → On Discord login page — please enter your credentials.\n");
      process.stdout.write("     Waiting for you to finish…\n");
      // Wait longer intervals while user types credentials
      await sleep(5000);
      continue;
    }

    // 3. We're on the applications page with real app cards
    if (url.includes("discord.com/developers/applications")) {
      // Confirm the welcome modal is gone AND there are no "Log In" prompts
      const stillHasModal = page.locator('[class*="modal"] button:has-text("Log In"), [class*="welcome"] button:has-text("Log In")');
      const hasModal = await stillHasModal.count() > 0;
      if (hasModal) {
        process.stdout.write(".");
        await sleep(2000);
        continue;
      }

      // Wait for app cards to hydrate (or empty-state illustration)
      await sleep(2000);
      const appCards = page.locator('a[href*="/applications/"]');
      const sortBar  = page.locator('text="Sort By"');
      const emptyState = page.locator('text="Create your first app"');
      const cardCount = await appCards.count();
      const hasSortBar = await sortBar.count() > 0;
      const isEmpty   = await emptyState.count() > 0;

      if (cardCount > 0 || hasSortBar || isEmpty) {
        process.stdout.write(`\n✓  Authenticated and on applications page (${cardCount} app links found)!\n`);
        return true;
      }
    }

    process.stdout.write(".");
    await sleep(3000);
  }

  return false;
}

async function scrapeApps(page) {
  await sleep(2000);
  const apps = await page.evaluate(() => {
    const seen = new Map();

    // Href-based: most reliable — navigation links contain the snowflake ID
    for (const el of document.querySelectorAll('a[href*="/applications/"]')) {
      const m = el.getAttribute("href")?.match(/\/applications\/(\d{17,20})/);
      if (!m) continue;
      const id = m[1];
      if (seen.has(id)) continue;
      let name = el.textContent?.trim() ?? "";
      if (!name) {
        let node = el.parentElement;
        for (let i = 0; i < 8 && node; i++) {
          const h = node.querySelector("h2,h3,[class*='cardName'],[class*='appName']");
          if (h?.textContent?.trim()) { name = h.textContent.trim(); break; }
          node = node.parentElement;
        }
      }
      seen.set(id, name || "(unnamed)");
    }

    // Fallback: look for bare snowflake text nodes
    if (seen.size === 0) {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const t = n.textContent?.trim() ?? "";
        if (/^\d{17,20}$/.test(t)) {
          const label = n.parentElement?.closest("[class]")?.textContent?.trim()?.slice(0, 60) ?? "(unknown)";
          seen.set(t, label);
        }
      }
    }

    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  });

  // Deduplicate, prefer longer (more descriptive) name
  const deduped = new Map();
  for (const app of apps) {
    const existing = deduped.get(app.id);
    if (!existing || app.name.length > existing.name.length) deduped.set(app.id, app.name);
  }
  return [...deduped.values()].map((name, i) => ({ id: [...deduped.keys()][i], name }));
}

async function readAppPage(page, appId) {
  await page.goto(`https://discord.com/developers/applications/${appId}/information`, {
    timeout: 30_000, waitUntil: "domcontentloaded",
  });
  await sleep(2500);
  await page.waitForLoadState("networkidle").catch(() => {});

  return page.evaluate(() => {
    const result = { appId: "", publicKey: "" };

    // Copy buttons next to the labeled fields
    const sections = Array.from(document.querySelectorAll("[class*='sectionTitle'],[class*='label'],[class*='Label']"));
    for (const sec of sections) {
      const text = sec.textContent?.toLowerCase() ?? "";
      const container = sec.closest("[class]");
      const input = container?.querySelector("input[value]") ?? container?.querySelector("[class*='value']");
      const val = input?.value?.trim() ?? input?.textContent?.trim() ?? "";

      if ((text.includes("application id") || text.includes("client id")) && /^\d{17,20}$/.test(val))
        result.appId = val;
      if (text.includes("public key") && /^[0-9a-f]{64}$/i.test(val))
        result.publicKey = val;
    }

    // Wider sweep if still empty
    if (!result.appId) {
      for (const input of document.querySelectorAll("input[value]")) {
        if (/^\d{17,20}$/.test(input.value.trim())) { result.appId = input.value.trim(); break; }
      }
    }
    if (!result.publicKey) {
      for (const input of document.querySelectorAll("input[value]")) {
        if (/^[0-9a-f]{64}$/i.test(input.value.trim())) { result.publicKey = input.value.trim(); break; }
      }
    }
    return result;
  });
}

const main = async () => {
  mkdirSync(profileDir, { recursive: true });
  const chromium = await loadPlaywright();

  console.log("\n🌐  Opening Discord Developer Portal (persistent profile)…");
  console.log(`   Profile dir: ${profileDir}`);

  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: false,
    args: ["--no-sandbox", "--window-size=1280,900"],
    slowMo: 60,
  });

  const page = ctx.pages()[0] ?? await ctx.newPage();

  await page.goto("https://discord.com/developers/applications", {
    timeout: 60_000, waitUntil: "domcontentloaded",
  });

  const loggedIn = await waitForApplicationsPage(page);
  if (!loggedIn) {
    await page.screenshot({ path: "/tmp/discord-timeout.png" });
    console.error("\n✗  Login timed out. /tmp/discord-timeout.png saved.");
    await ctx.close();
    process.exit(1);
  }

  const apps = await scrapeApps(page);
  printSeparator();
  console.log(`Found ${apps.length} Discord application(s):`);
  apps.forEach(a => console.log(`  [${a.id}]  ${a.name}`));
  printSeparator();

  if (apps.length === 0) {
    await page.screenshot({ path: "/tmp/discord-no-apps.png" });
    console.log("\n⚠  Could not auto-detect apps. Screenshot: /tmp/discord-no-apps.png");
    console.log("   The browser is still open — manually note your App IDs.");
    await sleep(120_000);
    await ctx.close();
    return;
  }

  // Interactive token collection
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));

  const envParts = {};

  for (const bot of BOTS) {
    // Match against all apps
    const match = apps.find(a =>
      bot.keywords.some(k => a.name.toLowerCase().includes(k))
    ) ?? (apps.length === 1 ? apps[0] : null);

    if (!match) {
      const answer = await ask(`\nNo app name matched "${bot.envPrefix}". Enter the App ID manually (or Enter to skip): `);
      if (!answer.trim()) continue;
      envParts[bot.envPrefix] = { appId: answer.trim(), pubKey: "", token: "" };
      continue;
    }

    printSeparator();
    console.log(`\n${bot.envPrefix}: "${match.name}"  (${match.id})`);

    const details = await readAppPage(page, match.id);
    const appId   = details.appId || match.id;
    const pubKey  = details.publicKey;
    await page.screenshot({ path: `/tmp/discord-info-${match.id}.png` });

    console.log(`  App ID:     ${appId}`);
    console.log(`  Public Key: ${pubKey || "(see /tmp/discord-info-" + match.id + ".png)"}`);

    // Go to Bot tab
    await page.goto(`https://discord.com/developers/applications/${match.id}/bot`, {
      timeout: 30_000, waitUntil: "domcontentloaded",
    });
    await sleep(2500);
    await page.screenshot({ path: `/tmp/discord-bot-${match.id}.png` });
    console.log(`\n  Bot page: /tmp/discord-bot-${match.id}.png`);
    console.log(`  → In the browser: click "Reset Token" → Yes, do it! → copy the token`);

    const token = await ask(`  Paste ${bot.envPrefix} bot token (or Enter to skip): `);
    envParts[bot.envPrefix] = { appId, pubKey, token: token.trim() };
  }
  rl.close();

  // Build .env snippet
  const lines = ["\n# ── Discord Bot Credentials ──────────────────────────"];
  for (const [prefix, val] of Object.entries(envParts)) {
    if (val.appId)  lines.push(`${prefix}_DISCORD_APP_ID=${val.appId}`);
    if (val.pubKey) lines.push(`${prefix}_DISCORD_PUBLIC_KEY=${val.pubKey}`);
    if (val.token)  lines.push(`${prefix}_DISCORD_BOT_TOKEN=${val.token}`);
  }
  const snippet = lines.join("\n") + "\n";

  printSeparator();
  console.log("Generated credentials:\n");
  console.log(snippet);
  printSeparator();

  if (writeFlag) {
    const envPath = resolve(repoRoot, ".env");
    const existing = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
    writeFileSync(envPath, existing.trimEnd() + snippet);
    console.log(`✅  Appended to ${envPath}`);
  } else {
    console.log('Run with --write to save to .env automatically.');
    console.log(`Or manually create ${resolve(repoRoot, ".env")} with the above.`);
  }

  await ctx.close();
};

main().catch(e => {
  console.error("\n✗", e instanceof Error ? e.message : String(e));
  process.exit(1);
});
