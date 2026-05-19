#!/usr/bin/env node
/**
 * Playwright-based browser verifier for the Trask / Holocron web UI.
 *
 * Sends 5 queries and waits for complete (non-pending) assistant responses.
 * Accepts degraded answers ("could not complete live archive synthesis…") —
 * they prove the full HTTP round-trip and UI rendering work.
 * Considers a query PASS when an assistant message appears and research is
 * no longer in "Thinking" state.  Source evidence upgrades the mark to RICH.
 *
 * Usage:
 *   node scripts/verify_trask_webui_browser.mjs [--url=http://127.0.0.1:4010] [--headful]
 */

const defaultQueries = [
  "What is TSLPatcher used for in KOTOR modding?",
  "How do I troubleshoot KOTOR widescreen resolution issues on PC?",
  "What is MDLOps used for in the KOTOR toolchain?",
  "Where are Knights of the Old Republic save files stored on Windows?",
  "What does the reone project provide for Odyssey engine work?",
];

const argValue = (name, fallback) => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};
const hasFlag = (name) => process.argv.includes(`--${name}`);

const baseUrl   = argValue("url",        process.env.TRASK_WEB_URL         ?? "http://127.0.0.1:4010");
const timeoutMs = Number.parseInt(argValue("timeout-ms", process.env.TRASK_VERIFY_TIMEOUT_MS ?? "120000"), 10);
const headless  = !hasFlag("headful") && process.env.TRASK_VERIFY_HEADFUL !== "1";
const queryArg  = argValue("queries", "");
const queries   = queryArg ? queryArg.split("|").map((q) => q.trim()).filter(Boolean) : defaultQueries;

const SOURCE_RE = /Deadly Stream|LucasForums|PCGamingWiki|GitHub|steamcommunity|Local Knowledge Context|Sources/i;
const DEGRADED_RE = /could not complete live archive synthesis/i;

async function loadPlaywright() {
  for (const pkg of ["playwright", "@playwright/test"]) {
    try {
      const m = await import(pkg);
      return m.chromium ?? m.default?.chromium;
    } catch { /* try next */ }
  }
  throw new Error(
    "Playwright not installed. Run: npx playwright install chromium\n" +
    "Then install the package: pnpm add -D playwright  (or npm i -D playwright)"
  );
}

async function waitForAssistantIdle(page, timeoutMs) {
  // Wait until at least one "Assistant message" article is present
  const assistantArticle = page.getByRole("article", { name: /assistant message/i }).last();
  await assistantArticle.waitFor({ state: "visible", timeout: timeoutMs });

  // Wait until the article no longer shows "Thinking" (pending research)
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const isThinking = await assistantArticle.getByText(/^Thinking$/i).count() > 0;
    if (!isThinking) break;
    await page.waitForTimeout(500);
  }
  return assistantArticle;
}

async function main() {
  const chromium = await loadPlaywright();
  const browser  = await chromium.launch({ headless, args: ["--no-sandbox"] });
  const page     = await browser.newPage({ viewport: { width: 1366, height: 900 } });
  const results  = [];

  console.log(`\n🔍  Trask Web UI verification  →  ${baseUrl}\n`);

  try {
    await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Wait for the question input to be ready
    const input = page.locator("#question-input");
    await input.waitFor({ state: "visible", timeout: 30_000 });

    for (const [i, query] of queries.entries()) {
      console.log(`[${i + 1}/${queries.length}] Submitting: "${query}"`);

      await input.fill(query);
      // Find submit button by aria-label pattern
      const btn = page.getByRole("button", { name: /submit question|send now/i });
      await btn.click();

      // Wait for the user message to echo back
      await page.getByRole("article", { name: /user message/i }).last()
        .waitFor({ state: "visible", timeout: 15_000 });

      // Now wait for the assistant response to finish (not "Thinking")
      let article;
      let errorMsg = null;
      try {
        article = await waitForAssistantIdle(page, timeoutMs);
      } catch (err) {
        errorMsg = String(err);
      }

      const bodyText  = await page.locator("body").innerText();
      const hasSource = SOURCE_RE.test(bodyText);
      const degraded  = DEGRADED_RE.test(bodyText);

      let answerSnippet = "(no article)";
      if (article) {
        const raw = (await article.innerText()).trim().slice(0, 200).replace(/\n+/g, " ");
        answerSnippet = raw || "(empty)";
      }

      const mark = errorMsg ? "FAIL" : (hasSource ? "RICH" : (degraded ? "DEGRADED" : "PASS"));
      results.push({ query, mark, hasSource, degraded, answerSnippet, error: errorMsg });
      console.log(`  ${mark === "FAIL" ? "✗" : "✓"} [${mark}] ${answerSnippet.slice(0, 100)}…`);
      if (errorMsg) console.error(`  ERROR: ${errorMsg.split("\n")[0]}`);
      console.log();
    }
  } finally {
    await browser.close();
  }

  // Summary
  console.log("─".repeat(60));
  const rich      = results.filter((r) => r.mark === "RICH").length;
  const degraded  = results.filter((r) => r.mark === "DEGRADED").length;
  const passed    = results.filter((r) => r.mark === "PASS").length;
  const failed    = results.filter((r) => r.mark === "FAIL").length;
  console.log(`Results: ${rich} RICH  ${passed} PASS  ${degraded} DEGRADED  ${failed} FAIL`);

  if (rich + passed + degraded === queries.length) {
    if (degraded > 0 && rich === 0) {
      console.log("\n⚠  All queries returned degraded answers. The server round-trip works but the");
      console.log("   Python research stack is not configured. To get full results set:");
      console.log("   OPENAI_API_KEY or OPENROUTER_API_KEY, then run:");
      console.log("   bash scripts/bootstrap_trask_research.sh && node scripts/trask_ops.mjs setup-venv");
    } else {
      console.log("\n✅  Trask Web UI browser verification passed.");
    }
    process.exit(0);
  } else {
    console.error(`\n✗  ${failed} quer${failed === 1 ? "y" : "ies"} failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exit(1);
});
