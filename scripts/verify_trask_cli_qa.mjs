#!/usr/bin/env node
/**
 * CLI verification for Trask Q&A (ResearchWizardClient → scripts/trask_web_research.py).
 *
 * Exercises the same path as Discord `/ask` and trask-http-server — not the browser.
 * Validates non-empty answers, Sources block, https URLs, and inline [n] citations when RICH.
 *
 * Usage (repo root):
 *   pnpm verify:trask-cli
 *   node --import tsx/esm scripts/verify_trask_cli_qa.mjs
 *
 * Preflight: `pnpm verify:trask-cli` runs `pnpm trask:gate` first
 * (build, full + CI optimize-measure) before live queries.
 * Live path auto-bootstraps indexer + retrieve Worker (8787) when unhealthy.
 *   node --import tsx/esm scripts/verify_trask_cli_qa.mjs --queries "What is TSLPatcher?"
 *   node --import tsx/esm scripts/verify_trask_cli_qa.mjs --import-smoke  # CI: no LLM
 *
 * Environment:
 *   INGEST_STATE_DIR — must match ingest-worker / Docker volume (default data/ingest-worker)
 *   TRASK_WEB_RESEARCH_PYTHON, TRASK_INDEXER_BASE_URL, OPENAI_API_KEY / OPENROUTER_API_KEY (optional)
 *   Loads .env, .env.local when present (does not print secrets).
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadResearchWizardRuntimeConfig, loadSharedAiConfig } from "@openkotor/config";
import {
  createResearchWizardClient,
  formatDiscordAskDisplay,
  splitResearchAnswer,
  DISCORD_ASK_MAX_BODY_LINES,
} from "@openkotor/trask";
import { degradedAnswerRegexes, goldenQueriesForSurface } from "@openkotor/trask-config";
import { loadEnvFiles, repoRoot } from "./lib/trask-env.mjs";
import { bootstrapTraskIndexedStack } from "./lib/trask_qa_stack_bootstrap.mjs";
import { composeGoldenCliAnswer, GOLDEN_IMPORT_SMOKE_IDS } from "./lib/compose_golden_cli_answer.mjs";

const DEFAULT_QUERIES = goldenQueriesForSurface("cli").map((entry) => ({
  question: entry.question,
  expectPattern: entry.expectRe,
  sourcePattern: entry.sourceRe,
}));

const DEGRADED_RE = degradedAnswerRegexes()[0] ?? /could not complete live (?:web )?research/i;
const MIN_HTTPS_SOURCES = DEFAULT_QUERIES[0]?.minCitations ?? 2;

const collapseWhitespace = (value) => {
  let out = "";
  let prevSpace = false;
  for (const ch of value) {
    if (/\s/u.test(ch)) {
      if (!prevSpace) {
        out += " ";
        prevSpace = true;
      }
    } else {
      out += ch;
      prevSpace = false;
    }
  }
  return out.trim();
};

const hasSourcesSection = (value) => {
  for (const line of value.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed === "sources" || trimmed === "references") return true;
  }
  return false;
};

const collectHttpUrls = (text) => {
  const urls = [];
  let i = 0;
  while (i < text.length) {
    const url = findHttpUrlInText(text, i);
    if (!url) break;
    urls.push(url);
    i = text.indexOf(url, i) + url.length;
  }
  return urls;
};

const collectBracketCitationIndices = (text) => {
  const indices = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== "[") {
      i += 1;
      continue;
    }
    let j = i + 1;
    let digits = "";
    while (j < text.length && text[j] >= "0" && text[j] <= "9") {
      digits += text[j];
      j += 1;
    }
    if (digits && text[j] === "]") {
      const value = Number(digits);
      if (Number.isFinite(value) && value > 0) indices.push(value);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return indices;
};

const countMarkdownHttpsLinks = (text) => {
  let count = 0;
  let i = 0;
  const needle = "](https://";
  while (i < text.length) {
    const at = text.indexOf(needle, i);
    if (at < 0) break;
    count += 1;
    i = at + needle.length;
  }
  return count;
};

const stripTrailingUrlPunctuation = (url) => {
  let end = url.length;
  while (end > 0 && ",.;:!?)".includes(url[end - 1])) end -= 1;
  return url.slice(0, end);
};

const findHttpUrlInText = (text, fromIndex = 0) => {
  const lower = text.toLowerCase();
  const httpsAt = lower.indexOf("https://", fromIndex);
  const httpAt = lower.indexOf("http://", fromIndex);
  const start =
    httpsAt < 0 ? httpAt : httpAt < 0 ? httpsAt : Math.min(httpsAt, httpAt);
  if (start < 0) return null;
  let end = start;
  while (end < text.length) {
    const ch = text[end];
    if (ch <= " " || ch === ")" || ch === "]") break;
    end += 1;
  }
  const raw = text.slice(start, end);
  return raw ? stripTrailingUrlPunctuation(raw) : null;
};

const countDistinctHttps = (text) => {
  const seen = new Set();
  let i = 0;
  while (i < text.length) {
    const url = findHttpUrlInText(text, i);
    if (!url) break;
    seen.add(url);
    i = text.indexOf(url, i) + url.length;
  }
  return seen.size;
};

const argValue = (name, fallback) => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};

const expectationForQuery = (query) => DEFAULT_QUERIES.find((entry) => entry.question === query) ?? null;

const importSmoke = process.argv.includes("--import-smoke");

const runImportSmoke = () => {
  loadEnvFiles();
  bootstrapTraskIndexedStack(repoRoot);

  let failed = 0;
  for (const goldenId of GOLDEN_IMPORT_SMOKE_IDS) {
    const { question, answer, approvedSources } = composeGoldenCliAnswer(goldenId);
    const scored = scoreAnswer(question, answer, approvedSources);
    if (scored.grade !== "RICH") {
      console.error(`import-smoke FAIL (${goldenId}): grade=${scored.grade}`, scored);
      failed += 1;
      continue;
    }
    console.log(`import-smoke OK: ${question.slice(0, 60)}… [RICH]`);
  }

  if (failed > 0) {
    process.exit(1);
  }
  console.log(`\nCLI verify import-smoke: ${GOLDEN_IMPORT_SMOKE_IDS.length}/${GOLDEN_IMPORT_SMOKE_IDS.length} passed.`);
};

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
  if (hasSourcesSection(display)) {
    return "Discord display still contains a Sources heading";
  }
  const linkedCount = countMarkdownHttpsLinks(display);
  const minLinked = approvedSources.length >= 2 ? MIN_HTTPS_SOURCES : 1;
  if (linkedCount < minLinked) {
    return `Discord display has ${linkedCount} linked https citation(s); need ≥${minLinked}`;
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
  const citedIndices = collectBracketCitationIndices(body);
  const sourceUrls = sourceLines
    .map((line) => findHttpUrlInText(line))
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
  const urlsInAnswer = collectHttpUrls(answer);
  const hasSourcesHeading = hasSourcesSection(answer);
  const hasInlineCitation = collectBracketCitationIndices(body).length > 0;
  const citationMisaligned = auditCitationAlignment(answer, approvedSources);
  const discordDisplayIssue = auditDiscordDisplay(answer, approvedSources);
  const hasSourceUrls =
    sourceLines.some((line) => findHttpUrlInText(line) !== null) || urlsInAnswer.length > 0;
  const degraded = DEGRADED_RE.test(answer);
  const substantive = collapseWhitespace(body).length >= 40;
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
  bootstrapTraskIndexedStack(repoRoot);

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

if (importSmoke) {
  runImportSmoke();
} else {
  await main();
}
