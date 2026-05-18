#!/usr/bin/env node
/**
 * CLI verification for Trask Q&A (ResearchWizardClient → trask_headless_research.py).
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
 *   TRASK_GPT_RESEARCHER_PYTHON, OPENAI_API_KEY / OPENROUTER_API_KEY, TAVILY_API_KEY (optional)
 *   Loads .env, .env.local, vendor/ai-researchwizard/.env when present (does not print secrets).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadResearchWizardRuntimeConfig, loadSharedAiConfig } from "../packages/config/dist/index.js";
import { createResearchWizardClient, splitResearchAnswer } from "../packages/trask/dist/index.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_QUERIES = [
  {
    question: "What is TSLPatcher used for in KOTOR modding?",
    expectPattern: /TSLPatcher|2DA|GFF|TLK|patch/i,
    sourcePattern: /tslpatcher|deadlystream|lucasforums|kotor\.neocities|github|https:\/\//i,
  },
  {
    question: "What does MDLOps do in the KotOR toolchain?",
    expectPattern: /MDLOps|MDL|model|conversion/i,
    sourcePattern: /mdlops|mdledit|kotormax|kotorblender|github|kotor\.neocities|https:\/\//i,
  },
  {
    question: "How do I troubleshoot KOTOR widescreen resolution on PC?",
    expectPattern: /widescreen|resolution|HUD|aspect|graphics/i,
    sourcePattern: /widescreen|resolution|deadlystream|pcgamingwiki|lucasforums|kotor\.neocities|https:\/\//i,
  },
  {
    question: "Where are Knights of the Old Republic save files stored on Windows?",
    expectPattern: /save|Saves|Windows|profile|KOTOR/i,
    sourcePattern: /save|windows|deadlystream|pcgamingwiki|lucasforums|kotor\.neocities|https:\/\//i,
  },
  {
    question: "What does the reone project provide for Odyssey engine work?",
    expectPattern: /reone|Odyssey|engine|open.?source/i,
    sourcePattern: /reone|github|xoreos|engine|https:\/\//i,
  },
];

const DEGRADED_RE = /could not complete live (?:web )?research/i;
const SOURCE_LINE_RE = /https?:\/\/[^\s)]+/i;
const MIN_HTTPS_SOURCES = 2;

const countDistinctHttps = (text) => {
  const matches = text.match(/https:\/\/[^\s)\]]+/gi);
  return matches ? new Set(matches).size : 0;
};

const loadEnvFiles = () => {
  for (const rel of [".env", ".env.local", "vendor/ai-researchwizard/.env"]) {
    const path = resolve(repoRoot, rel);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
};

const argValue = (name, fallback) => {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};

const expectationForQuery = (query) => DEFAULT_QUERIES.find((entry) => entry.question === query) ?? null;

const scoreAnswer = (query, answer, approvedSources) => {
  const { body, sourceLines } = splitResearchAnswer(answer);
  const urlsInAnswer = [...answer.matchAll(/[a-z][a-z0-9+.-]*:\/\/[^\s)]+/gi)].map((m) => m[0]);
  const hasSourcesHeading = /\nSources\s*\n/i.test(answer);
  const hasInlineCitation = /\[\d+\]/.test(body);
  const hasSourceUrls = sourceLines.some((line) => SOURCE_LINE_RE.test(line)) || urlsInAnswer.length > 0;
  const degraded = DEGRADED_RE.test(answer);
  const substantive = body.replace(/\s+/g, " ").trim().length >= 40;
  const expectation = expectationForQuery(query);
  const sourceText = `${sourceLines.join(" ")} ${approvedSources.map((source) => `${source.name} ${source.homeUrl}`).join(" ")}`;
  const topicMatch = expectation ? expectation.expectPattern.test(body) : true;
  const sourceMatch = expectation ? expectation.sourcePattern.test(sourceText) : approvedSources.length > 0;
  const httpsSourceCount = Math.max(
    approvedSources.filter((source) => source.homeUrl.startsWith("https://")).length,
    countDistinctHttps(sourceText),
    countDistinctHttps(answer),
  );
  const hasLocalTechnicalRef = /local:\/\/technical-reference/i.test(sourceText)
    || approvedSources.some((source) => source.homeUrl.startsWith("local://"));

  let grade = "FAIL";
  if (
    substantive
    && hasSourceUrls
    && approvedSources.length > 0
    && httpsSourceCount >= MIN_HTTPS_SOURCES
    && !hasLocalTechnicalRef
    && hasInlineCitation
    && !degraded
    && topicMatch
    && sourceMatch
  ) {
    grade = "RICH";
  } else if (
    substantive
    && approvedSources.length > 0
    && httpsSourceCount >= MIN_HTTPS_SOURCES
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

  console.log("\n🔬  Trask CLI Q&A verification (ResearchWizard → headless ai-researchwizard)\n");
  console.log(`   Python=${rwConfig.pythonExecutable}`);
  console.log(`   GPTR root=${rwConfig.gptResearcherRoot ?? "(auto)"}`);
  console.log(`   Timeout=${rwConfig.timeoutMs}ms\n`);

  const results = [];

  for (let i = 0; i < queries.length; i += 1) {
    const query = queries[i];
    console.log(`[${i + 1}/${queries.length}] ${query}`);
    const started = Date.now();
    try {
      const { answer, approvedSources, retrievedSources } = await client.answerQuestion(query, (ev) => {
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
