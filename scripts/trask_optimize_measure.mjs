#!/usr/bin/env node
/**
 * JSON measurement harness for ce-optimize Trask citation alignment runs.
 * Emits scalar metrics for faithfulness, unit suites, and citation stress tests.
 */
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureWorkspaceBuilt } from "./lib/trask_skip_build.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const run = (command, args, { allowFail = false } = {}) => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (result.status !== 0 && !allowFail) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`);
  }
  return result;
};

const countTests = (output) => {
  const pass = Number(output.match(/# pass (\d+)/)?.[1] ?? 0);
  const fail = Number(output.match(/# fail (\d+)/)?.[1] ?? 0);
  return { pass, fail, total: pass + fail };
};

const main = () => {
  const skipUnitTests = process.env.TRASK_OPTIMIZE_SKIP_UNIT_TESTS === "1";
  const skipCheck = process.env.TRASK_OPTIMIZE_SKIP_CHECK === "1";

  ensureWorkspaceBuilt(repoRoot);

  const faithfulness = run("node", ["scripts/trask_faithfulness_eval.mjs", "--fixtures"], { allowFail: true });
  const faithfulnessOutput = faithfulness.stdout + faithfulness.stderr;
  const faithfulnessPassCount = (faithfulnessOutput.match(/^PASS /gm) ?? []).length;
  const faithfulnessFailCount = (faithfulnessOutput.match(/^FAIL /gm) ?? []).length;
  const faithfulnessEvaluated = faithfulnessPassCount + faithfulnessFailCount;
  const faithfulnessPassRate =
    faithfulnessEvaluated > 0 ? faithfulnessPassCount / faithfulnessEvaluated : 0;

  let discordStats = { pass: 0, fail: 0, total: 0 };
  let groundedStats = { pass: 0, fail: 0, total: 0 };
  let composeStats = { pass: 0, fail: 0, total: 0 };

  if (!skipUnitTests) {
    const discordOut = run("node", ["--test", "packages/trask/dist/discord-reply-format.test.js"], {
      allowFail: true,
    });
    discordStats = countTests(discordOut.stdout + discordOut.stderr);

    const groundedOut = run("node", ["--test", "packages/trask/dist/grounded-evidence.test.js"], {
      allowFail: true,
    });
    groundedStats = countTests(groundedOut.stdout + groundedOut.stderr);

    const composeOut = run("node", ["--test", "packages/trask/dist/research-compose.test.js"], {
      allowFail: true,
    });
    composeStats = countTests(composeOut.stdout + composeOut.stderr);
  }

  const check = skipCheck ? { status: 0 } : run("pnpm", ["check"], { allowFail: true });

  const citationStressPassCount = discordStats.pass;
  const traskUnitPassRate = skipUnitTests
    ? 1
    : (discordStats.pass + groundedStats.pass + composeStats.pass)
      / Math.max(1, discordStats.total + groundedStats.total + composeStats.total);

  const checkPass = skipCheck || check.status === 0 ? 1 : 0;
  const compositeScore =
    (skipUnitTests ? 0 : citationStressPassCount * 10)
    + faithfulnessPassCount * 5
    + checkPass * 10;

  const payload = {
    citation_stress_pass_count: skipUnitTests ? null : citationStressPassCount,
    faithfulness_pass_count: faithfulnessPassCount,
    faithfulness_pass_rate: faithfulnessPassRate,
    trask_unit_pass_rate: traskUnitPassRate,
    discord_test_pass: skipUnitTests ? null : discordStats.pass === discordStats.total ? 1 : 0,
    grounded_test_pass: skipUnitTests ? null : groundedStats.pass === groundedStats.total ? 1 : 0,
    compose_test_pass: skipUnitTests ? null : composeStats.pass === composeStats.total ? 1 : 0,
    check_pass: checkPass,
    unit_tests_skipped: skipUnitTests ? 1 : 0,
    check_skipped: skipCheck ? 1 : 0,
    composite_score: compositeScore,
  };

  console.log(JSON.stringify(payload, null, 0));

  const unitOk = skipUnitTests || traskUnitPassRate >= 1;
  const checkOk = skipCheck || check.status === 0;
  if (faithfulnessPassRate < 1 || !unitOk || !checkOk) {
    process.exit(1);
  }
};

main();
