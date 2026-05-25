#!/usr/bin/env node
/**
 * Live Discord /ask pipeline gate: answerForSurface("discord") + formatDiscordAskDisplay.
 * Uses expert verification queries only (not golden fixture literals).
 *
 * Usage (repo root):
 *   pnpm verify:trask-discord
 *   node --import tsx/esm scripts/verify_trask_discord_live.mjs
 *
 * Preflight: `pnpm verify:trask-discord` runs `pnpm trask:gate` first
 * (build, full + CI optimize-measure) before live LLM calls.
 * Live path auto-bootstraps indexer + retrieve Worker (8787) when unhealthy.
 *   node --import tsx/esm scripts/verify_trask_discord_live.mjs --post
 *   node --import tsx/esm scripts/verify_trask_discord_live.mjs --skip-url-check
 *   node --import tsx/esm scripts/verify_trask_discord_live.mjs --import-smoke  # CI: no LLM/token
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadResearchWizardRuntimeConfig, loadSharedAiConfig } from "@openkotor/config";
import {
  createResearchWizardClient,
  formatDiscordAskDisplay,
  DISCORD_ASK_MAX_BODY_LINES,
} from "@openkotor/trask";
import { degradedAnswerRegexes, verificationQueriesForSurface } from "@openkotor/trask-config";
import { isHttpsCitationReachable } from "./lib/url-verify.mjs";
import { loadEnvFiles, repoRoot } from "./lib/trask-env.mjs";
import { bootstrapTraskIndexedStack } from "./lib/trask_qa_stack_bootstrap.mjs";

const DEFAULT_CHANNEL_ID = "1497410480208216306";

const IMPORT_SMOKE_FIXTURES = [
  {
    question:
      "When a KotOR mod ships 2DA and TLK changes, what does TSLPatcher automate that manual file copying cannot?",
    raw: `TSLPatcher on GitHub The TSLPatcher project documents how mod authors ship list-driven 2DA, GFF, and TLK changes for KotOR and TSL installs. [1]
TSLPatcher is a mod installation tool for Knights of the Old Republic and The Sith Lords. It applies 2DA, GFF, and TLK patches from list files so players do not copy files by hand. [2]

Sources
1. github.com - https://github.com/th3w1zard1/TSLPatcher
2. Deadly Stream - https://deadlystream.com/files/file/1982-tslpatcher`,
    approvedSources: [
      { name: "github.com", homeUrl: "https://github.com/th3w1zard1/TSLPatcher" },
      { name: "Deadly Stream", homeUrl: "https://deadlystream.com/files/file/1982-tslpatcher" },
    ],
    expectPattern: "TSLPatcher|2DA|TLK",
  },
  {
    question: "For a custom MDL exported from Blender, which MDLOps workflow step turns it back into game-ready KotOR models?",
    raw: `MDLOps repository MDLOps is used in the KotOR toolchain to import and export MDL/MDX assets between the game and DCC tools. [1]
MDLOps converts KotOR MDL and MDX for Blender and other DCC pipelines. [2]

Sources
1. github.com - https://github.com/ndixUR/MDLOps
2. Deadly Stream - https://deadlystream.com/files/file/1198-mdlops`,
    approvedSources: [
      { name: "github.com", homeUrl: "https://github.com/ndixUR/MDLOps" },
      { name: "Deadly Stream", homeUrl: "https://deadlystream.com/files/file/1198-mdlops" },
    ],
    expectPattern: "MDLOps|MDL",
  },
];

const QUERIES = verificationQueriesForSurface("discord").map((entry) => ({
  question: entry.question,
  expectPattern: entry.expectRe.source,
  forbidPattern: entry.forbidRe,
}));

const DEGRADED_RE = degradedAnswerRegexes()[0] ?? /could not complete live/i;
const postToDiscord = process.argv.includes("--post");
const skipUrlCheck = process.argv.includes("--skip-url-check");
const importSmoke = process.argv.includes("--import-smoke");
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

const runImportSmoke = () => {
  loadEnvFiles();
  bootstrapTraskIndexedStack(repoRoot);

  let failed = 0;
  for (const spec of IMPORT_SMOKE_FIXTURES) {
    const audit = auditDisplay(spec.question, spec.raw, spec.approvedSources);
    if (typeof audit === "string") {
      console.error(`import-smoke FAIL: ${audit}`);
      failed += 1;
      continue;
    }
    const expectRe = new RegExp(spec.expectPattern, "i");
    if (!expectRe.test(audit.display)) {
      console.error(`import-smoke FAIL: expectPattern ${spec.expectPattern} not matched`);
      failed += 1;
      continue;
    }
    console.log(`import-smoke OK: ${spec.question.slice(0, 60)}… (${audit.linked} links)`);
  }

  if (failed > 0) {
    process.exit(1);
  }
  console.log(`\nDiscord verify import-smoke: ${IMPORT_SMOKE_FIXTURES.length}/${IMPORT_SMOKE_FIXTURES.length} passed.`);
};

const runLive = async () => {
  loadEnvFiles();
  bootstrapTraskIndexedStack(repoRoot);
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
};

if (importSmoke) {
  runImportSmoke();
} else {
  await runLive();
}
