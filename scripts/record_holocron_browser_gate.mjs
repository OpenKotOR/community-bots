#!/usr/bin/env node
/**
 * Record Holocron browser gate evidence against a live :4010 stack (no webServer).
 * Mirrors holocron-research.spec.ts checks; writes docs/evidence/holocron-browser-gate-latest.md
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { chromium } from "@playwright/test";
import { loadTraskPolicy, verificationQueriesForSurface } from "@openkotor/trask-config";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseURL = process.env.HOLOCRON_E2E_BASE_URL ?? "http://127.0.0.1:4010";
const minHttps = loadTraskPolicy().holocron.minHttpsSources;
const queries = verificationQueriesForSurface("holocron");

async function runQuery(page, { question, expectPattern, sourcePattern }) {
  const threadId = randomUUID();
  await page.goto(`${baseURL}/?thread=${threadId}`, { waitUntil: "domcontentloaded" });
  const input = page.getByRole("textbox", { name: "Question input" });
  await input.waitFor({ state: "visible", timeout: 45_000 });
  await expectEnabled(input, 60_000);
  await input.fill(question);
  const submit = page.getByRole("button", { name: /submit question|send now/i });
  await submit.waitFor({ state: "visible", timeout: 10_000 });
  await expectEnabled(submit, 10_000);
  await submit.click();

  const assistant = page.getByRole("article", { name: /assistant message/i }).last();
  await assistant.waitFor({ state: "visible", timeout: 30_000 });
  await assistant.getByText(/^Thinking$/i).waitFor({ state: "hidden", timeout: 200_000 });

  const answerRegion = assistant.getByLabel("Answer", { exact: true });
  const bodyText = (await answerRegion.innerText()).trim();
  const expectRe = new RegExp(expectPattern, "i");
  const sourceRe = new RegExp(sourcePattern, "i");
  const httpsCount = (bodyText.match(/https:\/\/[^\s)\]]+/gu) ?? []).length;
  const citationLinks = await assistant.getByRole("link").filter({ hasText: /^[1-9]\d*$/ }).count();

  const failures = [];
  if (bodyText.length < 60) failures.push("answer too short");
  if (!expectRe.test(bodyText)) failures.push("topic mismatch");
  if (!sourceRe.test(bodyText)) failures.push("source pattern mismatch");
  if (/githubusercontent\.com/i.test(bodyText)) failures.push("githubusercontent in answer");
  if (httpsCount < minHttps && citationLinks < minHttps) failures.push(`need ≥${minHttps} https citations`);

  await assistant.getByRole("button", { name: /thought process/i }).click();
  const traceRegion = assistant.getByRole("region", { name: /thought process/i });
  const traceText = (await traceRegion.innerText()).trim();
  if (/githubusercontent\.com/i.test(traceText)) failures.push("githubusercontent in trace");

  return {
    question,
    pass: failures.length === 0,
    failures,
    snippet: bodyText.slice(0, 200).replace(/\s+/g, " "),
    httpsCount,
    citationLinks,
  };
}

async function expectEnabled(locator, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await locator.isEnabled()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("element not enabled within timeout");
}

const results = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });

try {
  const health = await page.request.get(`${baseURL}/api/trask/session`);
  if (!health.ok()) throw new Error(`session probe failed: ${health.status()}`);

  for (const query of queries) {
    results.push(await runQuery(page, query));
  }
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
const lines = [
  "# Holocron browser gate (live Playwright)",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Base URL: ${baseURL}`,
  "",
  `Passed: ${passed}/${results.length}`,
  "",
];

for (const row of results) {
  lines.push(`## ${row.pass ? "PASS" : "FAIL"} — ${row.question.slice(0, 72)}…`, "");
  if (row.failures.length) lines.push(`Failures: ${row.failures.join("; ")}`, "");
  lines.push(`Citations: ${row.citationLinks} numbered links, ${row.httpsCount} https strings in body`, "");
  lines.push("```", row.snippet, "```", "");
}

const outPath = resolve(repoRoot, "docs/evidence/holocron-browser-gate-latest.md");
writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`Wrote ${outPath}`);
console.log(`Passed ${passed}/${results.length}`);
if (passed !== results.length) process.exit(1);
