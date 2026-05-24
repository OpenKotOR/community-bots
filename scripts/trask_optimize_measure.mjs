#!/usr/bin/env node
/**
 * JSON measurement harness for ce-optimize Trask citation alignment runs.
 * Emits scalar metrics for faithfulness, unit suites, and citation stress tests.
 */
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
  run("pnpm", ["build"]);

  const faithfulness = run("node", ["scripts/trask_faithfulness_eval.mjs", "--fixtures"], { allowFail: true });
  const faithfulnessPass = faithfulness.status === 0 ? 5 : 0;

  const discordOut = run("node", ["--test", "packages/trask/dist/discord-reply-format.test.js"], { allowFail: true });
  const discordStats = countTests(discordOut.stdout + discordOut.stderr);

  const groundedOut = run("node", ["--test", "packages/trask/dist/grounded-evidence.test.js"], { allowFail: true });
  const groundedStats = countTests(groundedOut.stdout + groundedOut.stderr);

  const composeOut = run("node", ["--test", "packages/trask/dist/research-compose.test.js"], { allowFail: true });
  const composeStats = countTests(composeOut.stdout + composeOut.stderr);

  const check = run("pnpm", ["check"], { allowFail: true });

  const citationStressPassCount = discordStats.pass;
  const faithfulnessPassRate = faithfulnessPass / 5;
  const traskUnitPassRate =
    (discordStats.pass + groundedStats.pass + composeStats.pass)
    / Math.max(1, discordStats.total + groundedStats.total + composeStats.total);

  const payload = {
    citation_stress_pass_count: citationStressPassCount,
    faithfulness_pass_count: faithfulnessPass,
    faithfulness_pass_rate: faithfulnessPassRate,
    trask_unit_pass_rate: traskUnitPassRate,
    discord_test_pass: discordStats.pass === discordStats.total ? 1 : 0,
    grounded_test_pass: groundedStats.pass === groundedStats.total ? 1 : 0,
    compose_test_pass: composeStats.pass === composeStats.total ? 1 : 0,
    check_pass: check.status === 0 ? 1 : 0,
    composite_score:
      citationStressPassCount * 10
      + faithfulnessPass * 5
      + (check.status === 0 ? 10 : 0),
  };

  console.log(JSON.stringify(payload, null, 0));
  if (faithfulnessPassRate < 1 || traskUnitPassRate < 1 || check.status !== 0) {
    process.exit(1);
  }
};

main();
