#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pnpmVersion = "10.11.0";

const run = (command, args, options = {}) =>
  new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: "inherit",
      shell: process.platform === "win32",
      env: { ...process.env, ...options.env },
    });
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });

const hasCommand = (command) =>
  new Promise((resolveHas) => {
    const child = spawn(process.platform === "win32" ? "where" : "command", process.platform === "win32" ? [command] : ["-v", command], {
      stdio: "ignore",
      shell: true,
    });
    child.on("exit", (code) => resolveHas(code === 0));
  });

const pnpm = async (...args) => {
  if (await hasCommand("pnpm")) {
    await run("pnpm", args);
    return;
  }
  await run("npx", ["--yes", `pnpm@${pnpmVersion}`, ...args]);
};

const isPortOpen = (port, host = "127.0.0.1") =>
  new Promise((resolvePort) => {
    const socket = createServer();
    socket.once("error", () => resolvePort(true));
    socket.once("listening", () => {
      socket.close(() => resolvePort(false));
    });
    socket.listen(port, host);
  });

const command = process.argv[2] ?? "help";

const help = () => {
  console.log(`Trask / community-bots ops helper

Usage:
  node scripts/trask_ops.mjs setup          # pnpm install + init submodules + type-check
  node scripts/trask_ops.mjs setup-venv     # create .venv-trask-research (Crawl4AI) and install Python deps
  node scripts/trask_ops.mjs update         # git pull + pnpm install + build
  node scripts/trask_ops.mjs build-web      # build holocron-web (required before dev-http)
  node scripts/trask_ops.mjs dev-http       # build web + start Trask HTTP server on port 4010
  node scripts/trask_ops.mjs verify-cli     # CLI Trask Q&A via Crawl4AI web research (5 queries)
  node scripts/trask_ops.mjs verify-web     # Playwright browser test: 5 KOTOR queries (optional)
  node scripts/trask_ops.mjs smoke-discord  # verify Discord bot slash command registration

Quick start:
  1. cp .env.local.example .env  && fill in TRASK/HK/PAZAAK Discord tokens
  2. node scripts/trask_ops.mjs setup
  3. node scripts/trask_ops.mjs setup-venv   # for research support
  4. node scripts/trask_ops.mjs build-web
  5. node scripts/trask_ops.mjs dev-http     # serves on http://127.0.0.1:4010
  6. node scripts/trask_ops.mjs verify-cli   # confirm CLI Trask Q&A (5/5 RICH)
  7. pnpm dev:trask                          # start Trask Discord bot
  8. pnpm dev:hk                             # start HK-86 Discord bot
  9. pnpm dev:pazaak                         # start Pazaak Discord bot

Notes:
  - Falls back to npx pnpm@${pnpmVersion} when pnpm is not on PATH.
  - Run setup-venv and set TRASK_WEB_RESEARCH_PYTHON + OPENAI_API_KEY (or OPENROUTER_API_KEY) for live research.
  - Without an LLM API key (OPENAI_API_KEY or OPENROUTER_API_KEY) results are citation-only.
`);
};

try {
  switch (command) {
    case "setup": {
      // Init git submodules first so vendor/* is present before pnpm install
      await run("git", ["submodule", "update", "--init", "--recursive"]);
      await pnpm("install");
      await pnpm("rebuild", "esbuild");
      if (!existsSync(resolve(repoRoot, ".venv-trask-research"))) {
        console.log("⚠  Python venv not found. Run `node scripts/trask_ops.mjs setup-venv` for live research.");
      }
      await pnpm("check");
      break;
    }
    case "setup-venv": {
      const bootstrap =
        process.platform === "win32"
          ? resolve(repoRoot, "scripts", "bootstrap_trask_research.ps1")
          : resolve(repoRoot, "scripts", "bootstrap_trask_research.sh");
      if (process.platform === "win32") {
        await run("powershell", ["-ExecutionPolicy", "Bypass", "-File", bootstrap]);
      } else {
        await run("bash", [bootstrap]);
      }
      break;
    }
    case "update": {
      await run("git", ["pull", "--ff-only"]);
      await pnpm("install", "--frozen-lockfile");
      await pnpm("rebuild", "esbuild");
      await pnpm("build");
      break;
    }
    case "build-web": {
      await pnpm("--filter", "@openkotor/holocron-web", "build");
      break;
    }
    case "dev-http": {
      await pnpm("--filter", "@openkotor/holocron-web", "build");
      const port = Number.parseInt(process.env.TRASK_HTTP_PORT ?? "4010", 10);
      if (await isPortOpen(port)) {
        throw new Error(`Port ${port} is already in use. Stop the existing server or set TRASK_HTTP_PORT.`);
      }
      await pnpm("--filter", "@openkotor/trask-http-server", "dev");
      break;
    }
    case "verify-cli": {
      await run("node", ["--import", "tsx/esm", "scripts/verify_trask_cli_qa.mjs", ...process.argv.slice(3)]);
      break;
    }
    case "verify-web": {
      await run("node", ["scripts/verify_trask_webui_browser.mjs", ...process.argv.slice(3)]);
      break;
    }
    case "smoke-discord": {
      await run("node", ["scripts/discord_bots_smoke.mjs", ...process.argv.slice(3)]);
      break;
    }
    case "help":
    case "--help":
    case "-h":
      help();
      break;
    default:
      help();
      throw new Error(`Unknown trask ops command: ${command}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
