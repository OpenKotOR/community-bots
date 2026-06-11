#!/usr/bin/env node
/**
 * Post-deploy smoke: one Holocron query on GitHub Pages qa-webui via Playwright.
 * Writes docs/evidence/holocron-public-pages-gate-latest.md
 */
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { chromium } from "@playwright/test";
import { loadTraskPolicy } from "@openkotor/trask-config";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseURL =
  process.env.HOLOCRON_PUBLIC_BASE_URL ?? "https://openkotor.github.io/community-bots/qa-webui";
const apiBase =
  process.env.TRASK_API_BASE?.replace(/\/+$/, "") ??
  process.env.HOLOCRON_PUBLIC_API_BASE?.replace(/\/+$/, "") ??
  "https://trask-worker.bocloud.workers.dev";
const question =
  process.env.HOLOCRON_PUBLIC_GATE_QUERY ??
  "What does the reone project provide for Odyssey engine work?";
const minHttps = loadTraskPolicy().holocron.minHttpsSources;

async function probePublicApiHealth() {
  const healthUrl = `${apiBase}/healthz`;
  const res = await fetch(healthUrl, { signal: AbortSignal.timeout(30_000) });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      ok: false,
      healthUrl,
      status: res.status,
      detail: `non-JSON health response: ${text.slice(0, 200)}`,
    };
  }
  const upstreamOk = body.upstreamReachable !== false && body.ok !== false;
  if (res.status >= 500 || !upstreamOk) {
    return {
      ok: false,
      healthUrl,
      status: res.status,
      detail: JSON.stringify({
        ok: body.ok,
        upstream: body.upstream,
        upstreamReachable: body.upstreamReachable,
        upstreamStatus: body.upstreamStatus,
        upstreamDetail: body.upstreamDetail,
        hint: body.hint,
      }),
    };
  }
  return { ok: true, healthUrl, status: res.status, detail: text.slice(0, 400) };
}

async function expectEnabled(locator, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await locator.isEnabled()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("element not enabled within timeout");
}

const failures = [];
let snippet = "";
let httpsCount = 0;
let citationLinks = 0;
let healthProbe = null;

try {
  healthProbe = await probePublicApiHealth();
  if (!healthProbe.ok) {
    failures.push(
      `public API preflight failed (${healthProbe.healthUrl} HTTP ${healthProbe.status}): ${healthProbe.detail}`,
    );
  }
} catch (err) {
  failures.push(
    `public API preflight error (${apiBase}/healthz): ${err instanceof Error ? err.message : String(err)}`,
  );
}

let browser = null;
let page = null;

if (!failures.length) {
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
}

try {
  if (failures.length) throw new Error(failures[0]);

  const threadId = randomUUID();
  const url = `${baseURL.replace(/\/$/, "")}/?thread=${threadId}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

  const heading = page.getByRole("heading", { name: /HOLOCRON ARCHIVE/i });
  await heading.waitFor({ state: "visible", timeout: 45_000 });

  const input = page.getByRole("textbox", { name: "Question input" });
  await input.waitFor({ state: "visible", timeout: 45_000 });
  await expectEnabled(input, 90_000);
  await input.fill(question);

  const submit = page.getByRole("button", { name: /submit question|send now/i });
  await expectEnabled(submit, 15_000);
  await submit.click();

  const assistant = page.getByRole("article", { name: /assistant message/i }).last();
  await assistant.waitFor({ state: "visible", timeout: 45_000 });
  await assistant.getByText(/^Thinking$/i).waitFor({ state: "hidden", timeout: 240_000 });

  const answerRegion = assistant.getByLabel("Answer", { exact: true });
  const bodyText = (await answerRegion.innerText()).trim();
  snippet = bodyText.slice(0, 240).replace(/\s+/g, " ");
  httpsCount = (bodyText.match(/https:\/\/[^\s)\]]+/gu) ?? []).length;
  citationLinks = await assistant.getByRole("link").filter({ hasText: /^[1-9]\d*$/ }).count();

  if (bodyText.length < 40) failures.push("answer too short");
  if (!/reone|odyssey|engine/i.test(bodyText)) failures.push("answer off-topic for reone spot-check");
  if (/githubusercontent\.com/i.test(bodyText)) failures.push("githubusercontent in answer");
  if (httpsCount < minHttps && citationLinks < minHttps) {
    failures.push(`need ≥${minHttps} https citations or numbered links`);
  }
} catch (err) {
  if (failures.length === 0) {
    failures.push(String(err instanceof Error ? err.message : err));
  }
} finally {
  if (browser) await browser.close();
}

const pass = failures.length === 0;
const lines = [
  "# Holocron public Pages gate (qa-webui)",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `URL: ${baseURL}`,
  "",
  `API: ${apiBase}`,
  "",
  `Question: ${question}`,
  "",
  ...(healthProbe
    ? [`API preflight: ${healthProbe.ok ? "OK" : "FAIL"} (${healthProbe.healthUrl} HTTP ${healthProbe.status})`, ""]
    : []),
  "",
  `Result: ${pass ? "PASS" : "FAIL"}`,
  "",
];

if (failures.length) lines.push(`Failures: ${failures.join("; ")}`, "");
lines.push(`Citations: ${citationLinks} numbered links, ${httpsCount} https strings in body`, "");
lines.push("```", snippet || "(no answer text)", "```", "");

const outPath = resolve(repoRoot, "docs/evidence/holocron-public-pages-gate-latest.md");
writeFileSync(outPath, lines.join("\n"), "utf8");
console.log(`Wrote ${outPath}`);
console.log(pass ? "PASS" : "FAIL");
if (!pass) process.exit(1);
