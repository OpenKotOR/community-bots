#!/usr/bin/env node
/**
 * CLI verification for Trask Q&A (ResearchWizardClient → scripts/trask_web_research.py).
 *
 * Exercises the same path as Discord `/ask` and trask-http-server — not the browser.
 * Validates non-empty answers, Sources block, https URLs, and inline [n] citations when RICH.
 *
 * Usage (repo root, after `pnpm build`):
 *   node --import tsx/esm scripts/verify_trask_cli_qa.mjs
 *   node --import tsx/esm scripts/verify_trask_cli_qa.mjs --queries "What is TSLPatcher?"
 *
 * Environment:
 *   INGEST_STATE_DIR — must match ingest-worker / Docker volume (default data/ingest-worker)
 *   TRASK_WEB_RESEARCH_PYTHON, TRASK_INDEXER_BASE_URL, OPENAI_API_KEY / OPENROUTER_API_KEY (optional)
 *   Loads .env, .env.local when present (does not print secrets).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadResearchWizardRuntimeConfig, loadSharedAiConfig } from "../packages/config/dist/index.js";
import {
  createResearchWizardClient,
  formatDiscordAskDisplay,
  splitResearchAnswer,
  DISCORD_ASK_MAX_BODY_LINES,
} from "../packages/trask/dist/index.js";
import { goldenQueriesForSurface } from "../packages/trask-config/dist/golden-queries.js";
import { degradedAnswerRegexes } from "../packages/trask-config/dist/policy.js";
import { loadEnvFiles, repoRoot } from "./lib/trask-env.mjs";

const DEFAULT_QUERIES = goldenQueriesForSurface("cli").map((entry) => ({
  question: entry.question,
  expectPattern: entry.expectRe,
  sourcePattern: entry.sourceRe,
}));

const DEGRADED_RE = degradedAnswerRegexes()[0] ?? /could not complete live (?:web )?research/i;
const SOURCE_LINE_RE = /https?:\/\/[^\s)]+/i;
const MIN_HTTPS_SOURCES = DEFAULT_QUERIES[0]?.minCitations ?? 2;

const countDistinctHttps = (text) => {
  const matches = text.match(/https:\/\/[^\s)\]]+/gi);
  return matches ? new Set(matches).size : 0;
};

const argValue = (name, fallback) => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};

const expectationForQuery = (query) => DEFAULT_QUERIES.find((entry) => entry.question === query) ?? null;

const isBareCatalogHost = (url) => {
  try {
    const parsed = new URL(url);
    return parsed.pathname === "/" || parsed.pathname === "";
  } catch {
    return false;
  }
};

const auditDiscordDisplay = (answer, approvedSources) => {
  const display = formatDiscordAskDisplay(answer, approvedSources);
  const lines = display.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length > DISCORD_ASK_MAX_BODY_LINES) {
    return `Discord display has ${lines.length} lines (max ${DISCORD_ASK_MAX_BODY_LINES})`;
  }
  if (/\nSources\s*\n/i.test(display)) {
    return "Discord display still contains a Sources heading";
  }
  const linked = [...display.matchAll(/\]\(https:\/\/[^)]+\)/g)];
  const minLinked = approvedSources.length >= 2 ? MIN_HTTPS_SOURCES : 1;
  if (linked.length < minLinked) {
    return `Discord display has ${linked.length} linked https citation(s); need ≥${minLinked}`;
  }
  const onlyBareRoots =
    approvedSources.length >= MIN_HTTPS_SOURCES
    && approvedSources.every((source) => isBareCatalogHost(source.homeUrl));
  if (onlyBareRoots) {
    return "approvedSources are only bare catalog roots (no deep page URLs)";
  }
  return null;
};

const auditCitationAlignment = (answer, approvedSources) => {
  const { body, sourceLines } = splitResearchAnswer(answer);
  const citedIndices = [...body.matchAll(/\[(\d{1,3})\]/g)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);
  const sourceUrls = sourceLines
    .map((line) => line.match(/https?:\/\/\S+/i)?.[0])
    .filter(Boolean);

  if (citedIndices.length === 0 && sourceUrls.length > 0) {
    return "Sources listed without inline [n] citations in the answer body";
  }

  for (const index of citedIndices) {
    if (!sourceUrls[index - 1]) {
      return `Citation [${index}] is missing a matching Sources line`;
    }
  }

  if (approvedSources.length > citedIndices.length) {
    return "approvedSources includes URLs not cited in the answer body";
  }

  return null;
};

const scoreAnswer = (query, answer, approvedSources) => {
  const { body, sourceLines } = splitResearchAnswer(answer);
  const urlsInAnswer = [...answer.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s)]+/gi)].map((m) => m[0]);
  const hasSourcesHeading = /\nSources\s*\n/i.test(answer);
  const hasInlineCitation = /\[\d+\]/.test(body);
  const citationMisaligned = auditCitationAlignment(answer, approvedSources);
  const discordDisplayIssue = auditDiscordDisplay(answer, approvedSources);
  const hasSourceUrls = sourceLines.some((line) => SOURCE_LINE_RE.test(line)) || urlsInAnswer.length > 0;
  const degraded = DEGRADED_RE.test(answer);
  const substantive = body.replace(/\s+/g, " ").trim().length >= 40;
  const expectation = expectationForQuery(query);
  const sourceText = `${sourceLines.join(" ")} ${approvedSources.map((source) => `${source.name} ${source.homeUrl}`).join(" ")}`;
  const topicMatch = expectation ? expectation.expectPattern.test(body) : true;
  const sourceMatch = expectation ? expectation.sourcePattern.test(sourceText) : approvedSources.length > 0;
  const httpsApprovedCount = approvedSources.filter((source) =>
    source.homeUrl.startsWith("https://"),
  ).length;
  const httpsSourceCount = Math.max(
    httpsApprovedCount,
    countDistinctHttps(sourceText),
    countDistinctHttps(answer),
  );
  const minHttpsRequired = Math.min(MIN_HTTPS_SOURCES, Math.max(1, httpsApprovedCount));
  const hasLocalTechnicalRef = /local:\/\/technical-reference/i.test(sourceText)
    || approvedSources.some((source) => source.homeUrl.startsWith("local://"));

  let grade = "FAIL";
  if (
    substantive
    && hasSourceUrls
    && approvedSources.length > 0
    && httpsSourceCount >= minHttpsRequired
    && !hasLocalTechnicalRef
    && hasInlineCitation
    && !citationMisaligned
    && !discordDisplayIssue
    && !degraded
    && topicMatch
    && sourceMatch
  ) {
    grade = "RICH";
  } else if (
    substantive
    && approvedSources.length > 0
    && httpsSourceCount >= minHttpsRequired
    && !hasLocalTechnicalRef
    && !/^i could not complete live (?:web )?research for "/iu.test(answer.trim())
    && topicMatch
    && sourceMatch
  ) {
    grade = degraded ? "DEGRADED" : "PASS";
  }

  return {
    grade,
    bodyChars: body.length,
    sourceLineCount: sourceLines.length,
    approvedSourceCount: approvedSources.length,
    hasSourcesHeading,
    hasInlineCitation,
    hasSourceUrls,
    degraded,
    topicMatch,
    sourceMatch,
    httpsSourceCount,
    hasLocalTechnicalRef,
    citationMisaligned,
    discordDisplayIssue,
    query,
  };
};

const main = async () => {
  loadEnvFiles();

  const queryArg = argValue("queries", "");
  const queries = queryArg
    ? queryArg.split("|").map((q) => q.trim()).filter(Boolean)
    : DEFAULT_QUERIES.map((entry) => entry.question);

  const rwConfig = loadResearchWizardRuntimeConfig();
  const aiConfig = loadSharedAiConfig();
  const client = createResearchWizardClient(rwConfig, aiConfig);

  console.log("\n🔬  Trask CLI Q&A verification (ResearchWizard → trask_web_research.py)\n");
  console.log(`   Python=${rwConfig.pythonExecutable}`);
  console.log(`   Indexer=${rwConfig.indexerBaseUrl}`);
  console.log(`   Timeout=${rwConfig.timeoutMs}ms\n`);

  const results = [];

  for (let i = 0; i < queries.length; i += 1) {
    const query = queries[i];
    console.log(`[${i + 1}/${queries.length}] ${query}`);
    const started = Date.now();
    try {
      const { answer, approvedSources, retrievedSources } = await client.answerForSurface(query, "cli", (ev) => {
        if (ev.detail) {
          process.stdout.write(`   · ${ev.phase}: ${ev.detail}\n`);
        }
      });
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const scored = scoreAnswer(query, answer, approvedSources);
      results.push({ ...scored, elapsed, error: null });
      const preview = answer.replace(/\s+/g, " ").trim().slice(0, 160);
      console.log(`   ✓ [${scored.grade}] ${elapsed}s — ${preview}${answer.length > 160 ? "…" : ""}`);
      if (process.argv.includes("--full")) {
        console.log("\n--- answer ---\n");
        console.log(answer);
        console.log("\n--- end answer ---\n");
      }
      if (approvedSources.length > 0) {
        const sample = approvedSources.slice(0, 3).map((s) => s.homeUrl).join(", ");
        console.log(`   sources (${approvedSources.length}): ${sample}${approvedSources.length > 3 ? ", …" : ""}`);
      }
      if (retrievedSources.length > approvedSources.length) {
        console.log(`   retrieved (${retrievedSources.length}) candidate source(s)`);
      }
      if (!scored.topicMatch || !scored.sourceMatch) {
        console.log(
          `   quality flags: topicMatch=${scored.topicMatch} sourceMatch=${scored.sourceMatch}`,
        );
      }
    } catch (error) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        grade: "FAIL",
        query,
        elapsed,
        error: message,
        bodyChars: 0,
        sourceLineCount: 0,
        approvedSourceCount: 0,
        hasSourcesHeading: false,
        hasInlineCitation: false,
        hasSourceUrls: false,
        degraded: false,
      });
      console.log(`   ✗ [FAIL] ${elapsed}s — ${message}`);
    }
    console.log("");
  }

  const counts = { RICH: 0, PASS: 0, DEGRADED: 0, FAIL: 0 };
  for (const row of results) {
    counts[row.grade] = (counts[row.grade] ?? 0) + 1;
  }

  console.log("─".repeat(60));
  console.log(
    `Results: ${counts.RICH} RICH  ${counts.PASS} PASS  ${counts.DEGRADED} DEGRADED  ${counts.FAIL} FAIL`,
  );

  const minRich = Number.parseInt(argValue("min-rich", "0"), 10);
  const ok = counts.FAIL === 0 && counts.DEGRADED === 0 && counts.RICH + counts.PASS === queries.length && counts.RICH >= minRich;

  if (ok) {
    console.log("\n✅  Trask CLI Q&A verification passed.\n");
    process.exit(0);
  }

  console.log(`\n❌  Expected all queries to finish as PASS/RICH with zero FAIL/DEGRADED and at least ${minRich} RICH.\n`);
  process.exit(1);
};

await main();
