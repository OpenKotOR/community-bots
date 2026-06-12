#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { analyzeBinary, generateReconstructionWorkspace, writeReconstructionWorkspace } from "./index.js";

const [, , inputPath, ...rest] = process.argv;

if (inputPath === undefined || rest.includes("--help") || rest.includes("-h")) {
  console.error("Usage: decomp-analyze <binary-path> [--pretty] [--workspace] [--write-workspace <output-dir>]");
  process.exit(inputPath === undefined ? 1 : 0);
}

const pretty = rest.includes("--pretty");
const workspace = rest.includes("--workspace");
const writeWorkspaceDir = optionValue(rest, "--write-workspace");
const bytes = await readFile(inputPath);
const report = analyzeBinary({ path: inputPath, bytes });
const reconstructionWorkspace = workspace || writeWorkspaceDir !== undefined
  ? generateReconstructionWorkspace(report)
  : undefined;
const output = writeWorkspaceDir !== undefined
  ? await writeReconstructionWorkspace(reconstructionWorkspace ?? generateReconstructionWorkspace(report), writeWorkspaceDir)
  : reconstructionWorkspace ?? report;

console.log(JSON.stringify(output, bigintJsonReplacer, pretty ? 2 : 0));

function bigintJsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function optionValue(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    console.error(`Missing value for ${name}`);
    process.exit(1);
  }
  return value;
}
