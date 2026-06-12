#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { analyzeBinary, generateReconstructionWorkspace } from "./index.js";

const [, , inputPath, ...rest] = process.argv;

if (inputPath === undefined || rest.includes("--help") || rest.includes("-h")) {
  console.error("Usage: decomp-analyze <binary-path> [--pretty] [--workspace]");
  process.exit(inputPath === undefined ? 1 : 0);
}

const pretty = rest.includes("--pretty");
const workspace = rest.includes("--workspace");
const bytes = await readFile(inputPath);
const report = analyzeBinary({ path: inputPath, bytes });
const output = workspace ? generateReconstructionWorkspace(report) : report;

console.log(JSON.stringify(output, bigintJsonReplacer, pretty ? 2 : 0));

function bigintJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
