#!/usr/bin/env node
/**
 * Live Discord /ask pipeline gate: answerForSurface("discord") + formatDiscordAskDisplay.
 * Uses expert verification queries only (not golden fixture literals).
 *
 * Usage (repo root, after pnpm build):
 *   node --import tsx/esm scripts/verify_trask_discord_live.mjs
 *   node --import tsx/esm scripts/verify_trask_discord_live.mjs --post
 *   node --import tsx/esm scripts/verify_trask_discord_live.mjs --skip-url-check
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadResearchWizardRuntimeConfig, loadSharedAiConfig } from "../packages/config/dist/index.js";
import {
  createResearchWizardClient,
  formatDiscordAskDisplay,
  DISCORD_ASK_MAX_BODY_LINES,
} from "../packages/trask/dist/index.js";
import { verificationQueriesForSurface } from "../packages/trask-config/dist/verification-queries.js";
import { degradedAnswerRegexes } from "../packages/trask-config/dist/policy.js";
import { isHttpsCitationReachable } from "./lib/url-verify.mjs";
import { loadEnvFiles, repoRoot } from "./lib/trask-env.mjs";

const DEFAULT_CHANNEL_ID = "1497410480208216306";

const QUERIES = verificationQueriesForSurface("discord").map((entry) => ({
  question: entry.question,
  expectPattern: entry.expectRe.source,
  forbidPattern: entry.forbidRe,
}));

const DEGRADED_RE = degradedAnswerRegexes()[0] ?? /could not complete live/i;
const postToDiscord = process.argv.includes("--post");
const skipUrlCheck = process.argv.includes("--skip-url-check");
const MIN_INLINE_LINKS = 2;

const extractInlineHttpsUrls = (display) => [...display.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1]);

const auditDisplay = (question, answer, approvedSources) => {
  const display = formatDiscordAskDisplay(answer, approvedSources, { query: question });
  const lines = display.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (DEGRADED_RE.test(display)) {
    return "degraded synthesis message";
  }
  if (/\nSources\s*\n/i.test(display) || /^\s*Sources\b/im.test(display)) {
    return "visible Sources block in embed description";
  }
  if (lines.length > DISCORD_ASK_MAX_BODY_LINES) {
    return `${lines.length} lines (max ${DISCORD_ASK_MAX_BODY_LINES})`;
  }
  if (/^Answer for:/im.test(display) || /\bAnswer for:/i.test(display)) {
    return "contains Answer for: prefix";
  }
  if (/^\s*-\s*#\s+/m.test(display) || /^\s*#\s+\w/m.test(display)) {
    return "contains markdown # topic headings";
  }
  const linked = [...display.matchAll(/\]\(https:\/\/[^)]+\)/g)];
  if (linked.length < MIN_INLINE_LINKS) {
    return `only ${linked.length} inline https link(s); need ≥${MIN_INLINE_LINKS}`;
  }
  if (approvedSources.length < MIN_INLINE_LINKS) {
    return `only ${approvedSources.length} approved source(s); need ≥${MIN_INLINE_LINKS}`;
  }
  return { display, lines: lines.length, linked: linked.length, urls: extractInlineHttpsUrls(display) };
};

loadEnvFiles();
loadSharedAiConfig();
const wizard = createResearchWizardClient(loadResearchWizardRuntimeConfig());

const results = [];
let failed = 0;

for (const spec of QUERIES) {
  const expectRe = new RegExp(spec.expectPattern, "i");
  process.stdout.write(`… ${spec.question.slice(0, 72)}${spec.question.length > 72 ? "…" : ""}\n`);

  const result = await wizard.answerForSurface(spec.question, "discord");
  const audit = auditDisplay(spec.question, result.answer, result.approvedSources);

  if (typeof audit === "string") {
    failed += 1;
    results.push({ question: spec.question, ok: false, error: audit });
    console.log(`  FAIL: ${audit}\n`);
    continue;
  }

  const { display, urls } = audit;
  if (!skipUrlCheck && urls?.length) {
    const unreachable = [];
    for (const url of urls) {
      const ok = await isHttpsCitationReachable(url);
      if (!ok) unreachable.push(url);
    }
    if (unreachable.length > 0) {
      failed += 1;
      results.push({
        question: spec.question,
        ok: false,
        error: `unreachable citation URL(s) (404 or network): ${unreachable.join(", ")}`,
      });
      console.log(`  FAIL: unreachable link(s)\n`);
      continue;
    }
  }

  if (!expectRe.test(display)) {
    failed += 1;
    results.push({ question: spec.question, ok: false, error: `expectPattern ${spec.expectPattern} not matched` });
    console.log(`  FAIL: off-topic or empty body\n`);
    continue;
  }
  const bodyForTopicCheck = display.replace(/\]\(https:\/\/[^)]+\)/g, "");
  if (spec.forbidPattern && spec.forbidPattern.test(bodyForTopicCheck)) {
    failed += 1;
    results.push({ question: spec.question, ok: false, error: "forbidden cross-topic keyword in answer body" });
    console.log(`  FAIL: catalog bleed (forbidden topic keyword)\n`);
    continue;
  }

  results.push({ question: spec.question, ok: true, display, lines: audit.lines, linked: audit.linked });
  console.log(`  OK (${audit.lines} line(s), ${audit.linked} link(s))\n`);

  if (postToDiscord) {
    const token = process.env.TRASK_DISCORD_BOT_TOKEN?.trim();
    const channelId = process.env.TRASK_DISCORD_TEST_CHANNEL_ID?.trim() || DEFAULT_CHANNEL_ID;
    if (!token) {
      console.error("TRASK_DISCORD_BOT_TOKEN required for --post");
      process.exit(1);
    }
    const embed = {
      title: "Trask Ulgo Briefing",
      description: display.length > 4000 ? `${display.slice(0, 3999)}…` : display,
      color: 0x5865f2,
    };
    const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      console.error("  Discord post failed:", res.status, body);
      failed += 1;
    } else {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
}

const reportPath = resolve(repoRoot, "docs/evidence/2026-05-19-discord-ask-live-verify.md");
const reportLines = [
  "# Discord /ask live verify",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Queries: ${QUERIES.length} (expert verification set; URL reachability enforced)`,
  `Passed: ${results.filter((r) => r.ok).length}/${QUERIES.length}`,
  "",
];

for (const row of results) {
  reportLines.push(`## ${row.question}`, "", row.ok ? "PASS" : `FAIL: ${row.error}`, "");
  if (row.display) {
    reportLines.push("```", row.display, "```", "");
  }
}

writeFileSync(reportPath, reportLines.join("\n"));
console.log(`Wrote ${reportPath}`);

if (failed > 0) {
  console.error(`\n${failed} query/queries failed`);
  process.exit(1);
}

console.log(`\nAll ${QUERIES.length} Discord /ask checks passed.`);
