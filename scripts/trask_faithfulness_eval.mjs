#!/usr/bin/env node
/**
 * Offline faithfulness / citation-alignment checks for Trask golden fixtures.
 *
 * Usage:
 *   node scripts/trask_faithfulness_eval.mjs --fixtures
 *   node scripts/trask_faithfulness_eval.mjs --dir data/trask-eval/runs/latest
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { splitResearchAnswer } from "../packages/trask/dist/discord-reply-format.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const goldenPath = join(repoRoot, "data/trask-eval/golden-queries.json");

const collectCitationIndices = (answer) => {
  const { body } = splitResearchAnswer(answer);
  const indices = new Set();
  for (const match of body.matchAll(/\[(\d{1,3})\]/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) indices.add(value);
  }
  return [...indices].sort((a, b) => a - b);
};

const parseSourcesFromAnswer = (answer) => {
  const { sourceLines } = splitResearchAnswer(answer);
  return sourceLines
    .map((line) => line.match(/https?:\/\/\S+/i)?.[0])
    .filter(Boolean);
};

const auditAnswer = (answer, { minCitations = 2, expectPattern }) => {
  const errors = [];
  const indices = collectCitationIndices(answer);
  const sourceUrls = parseSourcesFromAnswer(answer);

  if (indices.length < minCitations) {
    errors.push(`expected at least ${minCitations} inline [n] citations, got ${indices.length}`);
  }

  if (sourceUrls.length < minCitations) {
    errors.push(`expected at least ${minCitations} Sources URLs, got ${sourceUrls.length}`);
  }

  for (const index of indices) {
    if (!sourceUrls[index - 1]) {
      errors.push(`citation [${index}] has no matching Sources line`);
    }
  }

  if (sourceUrls.length > indices.length) {
    errors.push(`Sources list has ${sourceUrls.length - indices.length} uncited URL(s)`);
  }

  if (expectPattern) {
    const re = new RegExp(expectPattern, "i");
    if (!re.test(answer)) {
      errors.push(`answer did not match expectPattern /${expectPattern}/i`);
    }
  }

  return errors;
};

const loadFixtureRuns = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const path = join(dir, name);
      return { path, data: JSON.parse(readFileSync(path, "utf8")) };
    });
};

const main = () => {
  const args = process.argv.slice(2);
  const fixturesMode = args.includes("--fixtures");
  const dirArg = args.find((arg) => arg.startsWith("--dir="))?.slice("--dir=".length)
    ?? (args.includes("--dir") ? args[args.indexOf("--dir") + 1] : undefined);

  if (!fixturesMode && !dirArg) {
    console.error("Usage: node scripts/trask_faithfulness_eval.mjs --fixtures | --dir <path>");
    process.exit(2);
  }

  let failures = 0;

  if (fixturesMode) {
    const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
    const fixtureDir = join(repoRoot, "data/trask-eval/fixtures");
    for (const spec of golden.queries) {
      const fixturePath = join(fixtureDir, `${spec.id}.json`);
      if (!existsSync(fixturePath)) {
        console.warn(`skip ${spec.id}: missing fixture ${fixturePath}`);
        continue;
      }
      const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
      const answer = String(fixture.answer ?? "");
      const errors = auditAnswer(answer, spec);
      if (errors.length) {
        failures += 1;
        console.error(`FAIL ${spec.id}:\n  - ${errors.join("\n  - ")}`);
      } else {
        console.log(`PASS ${spec.id}`);
      }
    }
  }

  if (dirArg) {
    const runs = loadFixtureRuns(resolve(dirArg));
    for (const run of runs) {
      const id = run.data.id ?? run.path;
      const errors = auditAnswer(String(run.data.answer ?? ""), run.data);
      if (errors.length) {
        failures += 1;
        console.error(`FAIL ${id}:\n  - ${errors.join("\n  - ")}`);
      } else {
        console.log(`PASS ${id}`);
      }
    }
  }

  if (failures > 0) {
    process.exit(1);
  }
  console.log("Faithfulness eval passed.");
};

main();
