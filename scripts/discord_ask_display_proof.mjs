#!/usr/bin/env node
/**
 * Writes docs/evidence/*-discord-ask-ux-proof.md for the three golden /ask queries.
 * Uses the same answerQuestionBrief + formatDiscordAskDisplay path as apps/trask-bot.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadResearchWizardRuntimeConfig, loadSharedAiConfig } from "../packages/config/dist/index.js";
import {
  createResearchWizardClient,
  formatDiscordAskDisplay,
  DISCORD_ASK_MAX_BODY_LINES,
} from "../packages/trask/dist/index.js";
import { goldenQueriesForSurface } from "../packages/trask-config/dist/golden-queries.js";
import { loadEnvFiles, repoRoot } from "./lib/trask-env.mjs";

const GOLDEN_QUERIES = goldenQueriesForSurface("discord").map((entry) => entry.question);

loadEnvFiles();
loadSharedAiConfig();
const wizard = createResearchWizardClient(loadResearchWizardRuntimeConfig());

const lines = [
  "# Discord /ask display proof (brief compose + formatDiscordAskDisplay)",
  "",
  `Generated: ${new Date().toISOString()}`,
  "",
  "This is the embed **description** string the bot sends after `buildResearchEmbed` (no Sources embed fields).",
  "",
];

for (const query of GOLDEN_QUERIES) {
  const result = await wizard.answerForSurface(query, "discord");
  const display = formatDiscordAskDisplay(result.answer, result.approvedSources);
  const lineCount = display.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  const linked = [...display.matchAll(/\]\(https:\/\/[^)]+\)/g)].length;

  lines.push(`## ${query}`, "", "```", display, "```", "", `- lines: ${lineCount} (max ${DISCORD_ASK_MAX_BODY_LINES})`);
  lines.push(`- linked https citations: ${linked}`);
  lines.push(`- approvedSources: ${result.approvedSources.map((s) => s.homeUrl).join(", ")}`, "");
}

const outPath = resolve(repoRoot, "docs/evidence/2026-05-19-discord-ask-ux-proof.md");
writeFileSync(outPath, lines.join("\n"));
console.log(`Wrote ${outPath}`);
