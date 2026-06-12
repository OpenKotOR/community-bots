#!/usr/bin/env node
import { spawn, execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
const dataDir = resolve(repoRoot, process.env.TRASK_INDEXER_DATA_DIR ?? "data/trask-indexer");
const discordTargetsConfig = process.env.TRASK_DISCORD_EXPORT_TARGETS_CONFIG ?? resolve(repoRoot, "data/trask/discord-export-targets.json");

const outputJson = (payload) => {
  console.log(JSON.stringify(payload, null, 2));
};

const readJsonIfExists = (path) => {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
};

const listDiscordTargets = () => {
  const payload = readJsonIfExists(discordTargetsConfig);
  const targets = Array.isArray(payload?.targets) ? payload.targets : [];
  return targets.map((target) => ({
    name: String(target.name ?? ""),
    enabled: target.enabled !== false,
    outputDir: String(target.output_dir ?? ""),
    disabledReason: String(target.disabled_reason ?? ""),
    guildIds: Array.isArray(target.guild_ids) ? target.guild_ids.map(String) : [],
    channelIds: Array.isArray(target.channel_ids) ? target.channel_ids.map(String) : [],
  })).filter((target) => target.name);
};

const retrieveBaseUrl = () => (process.env.TRASK_INDEXER_BASE_URL ?? "http://127.0.0.1:8787").replace(/\/+$/u, "");

const postJson = async (url, payload, headers = {}) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { text };
  }
  return { ok: response.ok, status: response.status, body: parsed };
};

const help = () => {
  console.log(`Trask / community-bots ops helper

Usage:
  node scripts/trask_ops.mjs setup          # pnpm install + init submodules + type-check
  node scripts/trask_ops.mjs setup-venv     # create .venv-trask-research (trask_web_research.py)
  node scripts/trask_ops.mjs update         # git pull + pnpm install + build
  node scripts/trask_ops.mjs build-web      # build holocron-web (required before dev-http)
  node scripts/trask_ops.mjs dev-http       # build web + start Trask HTTP server on port 4010
  node scripts/trask_ops.mjs verify-cli     # CLI Trask Q&A smoke (5 queries)
  node scripts/trask_ops.mjs verify-web     # Playwright browser test: 5 KOTOR queries (optional)
  node scripts/trask_ops.mjs smoke-discord  # verify Discord bot slash command registration
  node scripts/trask_ops.mjs capabilities   # JSON list of agent-readable Trask actions
  node scripts/trask_ops.mjs sources        # JSON source/freshness snapshot
  node scripts/trask_ops.mjs provider-health # JSON provider configuration health
  node scripts/trask_ops.mjs evidence "q"   # JSON evidence pack from /retrieve
  node scripts/trask_ops.mjs refresh-dry-run # JSON dry-run refresh request/status
  node scripts/trask_ops.mjs purge-discord-message --channel-id C --message-id M [--guild-id G] [--execute]

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
  - Run setup-venv and set TRASK_WEB_RESEARCH_PYTHON / TRASK_INDEXER_BASE_URL for live research.
  - Trask inference is HF_TOKEN first, Cloudflare second; without hosted providers it returns deterministic cited fallback where possible.
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
      await run("bash", ["scripts/bootstrap_trask_research.sh"]);
      const py =
        process.platform === "win32"
          ? resolve(repoRoot, ".venv-trask-research", "Scripts", "python.exe")
          : resolve(repoRoot, ".venv-trask-research", "bin", "python");
      console.log("✅  .venv-trask-research ready.");
      console.log("   Add to your .env:");
      console.log(`   TRASK_WEB_RESEARCH_PYTHON=${py}`);
      console.log("   TRASK_INDEXER_BASE_URL=http://127.0.0.1:8790");
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
      // NOTE: script deleted c47c52f (not restored); alias in root package.json also broken. Use smoke-imports:ci + discord verify for now.
      throw new Error("verify-cli: verify_trask_cli_qa.mjs was removed (residual from free-llm plan 118)");
    }
    case "verify-web": {
      // NOTE: script deleted c47c52f; browser MCP + playwright (limited) now preferred.
      throw new Error("verify-web: verify_trask_webui_browser.mjs was removed (residual)");
    }
    case "smoke-discord": {
      await run("node", ["scripts/discord_bots_smoke.mjs", ...process.argv.slice(3)]);
      break;
    }
    case "capabilities": {
      outputJson({
        ok: true,
        workspace: repoRoot,
        actions: [
          { id: "sources", mutates: false, description: "List approved web and Discord archive sources plus freshness status." },
          { id: "provider-health", mutates: false, description: "Inspect configured Hugging Face, Cloudflare, and legacy provider readiness." },
          { id: "evidence", mutates: false, description: "POST a query to /retrieve and return the evidence pack." },
          { id: "refresh-dry-run", mutates: false, description: "Send a dry-run /reindex request when a tokened indexer endpoint is configured." },
          { id: "purge-discord-message", mutates: true, dryRunDefault: true, description: "Purge indexed evidence rows covering a Discord message id." },
          { id: "smoke-discord", mutates: false, description: "Run Discord command registration smoke." },
        ],
        safetyLimits: {
          destructiveActionsDefaultToDryRun: true,
          purgeRequiresExplicitCommand: true,
          discordPrivateChannelsIndexedByDefault: false,
        },
        requiredCredentials: {
          huggingFace: "HF_TOKEN or HUGGINGFACE_TOKEN",
          cloudflareFallback: "TRASK_CLOUDFLARE_AI_BASE_URL plus TRASK_CLOUDFLARE_AI_TOKEN or Cloudflare AI Gateway env",
          reindex: "TRASK_REINDEX_TOKEN and TRASK_INDEXER_BASE_URL",
        },
      });
      break;
    }
    case "sources": {
      const allowlist = readJsonIfExists(resolve(dataDir, "allowlist.json"));
      const discordStatus = readJsonIfExists(resolve(dataDir, "discord_sync_status.json"));
      outputJson({
        ok: true,
        dataDir,
        allowlist: {
          sources: Array.isArray(allowlist?.sources) ? allowlist.sources : [],
          baseHosts: Array.isArray(allowlist?.baseHosts) ? allowlist.baseHosts : [],
          urlPrefixes: Array.isArray(allowlist?.urlPrefixes) ? allowlist.urlPrefixes : [],
        },
        discord: {
          targetsConfig: discordTargetsConfig,
          targets: listDiscordTargets(),
          syncStatus: discordStatus,
        },
      });
      break;
    }
    case "provider-health": {
      const hf = Boolean(process.env.HF_TOKEN || process.env.HUGGINGFACE_TOKEN);
      const cf = Boolean(
        (process.env.TRASK_CLOUDFLARE_AI_BASE_URL || process.env.CLOUDFLARE_AI_GATEWAY_BASE_URL)
        && (process.env.TRASK_CLOUDFLARE_AI_TOKEN || process.env.CLOUDFLARE_AI_GATEWAY_TOKEN || process.env.CLOUDFLARE_API_TOKEN),
      );
      const haReady = hf && cf;
      outputJson({
        ok: true,
        haReady,
        providerOrder: ["huggingface", "cloudflare", "deterministic-extractive"],
        providers: [
          { id: "huggingface", configured: hf, model: process.env.TRASK_HF_CHAT_MODEL ?? process.env.HF_CHAT_MODEL ?? "Qwen/Qwen3-4B-Instruct-2507:fastest" },
          { id: "cloudflare", configured: cf, model: process.env.TRASK_CLOUDFLARE_CHAT_MODEL ?? process.env.CLOUDFLARE_WORKERS_AI_MODEL ?? "@cf/meta/llama-3.1-8b-instruct-fast" },
          { id: "deterministic-extractive", configured: true, model: "local-template" },
        ],
        warnings: [
          ...(hf ? [] : ["Hugging Face is not configured; hosted primary synthesis is unavailable."]),
          ...(cf ? [] : ["Cloudflare AI is not configured; hosted HA fallback is unavailable."]),
        ],
        legacyOpenAiKeysIgnoredForPrimaryTraskPath: Boolean(process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY),
      });
      break;
    }
    case "evidence": {
      const query = process.argv.slice(3).join(" ").trim();
      if (!query) throw new Error("Usage: node scripts/trask_ops.mjs evidence \"question\"");
      const result = await postJson(`${retrieveBaseUrl()}/retrieve`, {
        query,
        limit: Number.parseInt(process.env.TRASK_OPS_EVIDENCE_LIMIT ?? "8", 10),
      });
      outputJson({
        ok: result.ok,
        status: result.status,
        retrieveBaseUrl: retrieveBaseUrl(),
        ...result.body,
      });
      if (!result.ok) process.exitCode = 1;
      break;
    }
    case "refresh-dry-run": {
      const token = process.env.TRASK_REINDEX_TOKEN ?? "";
      if (!token) {
        outputJson({
          ok: false,
          dryRun: true,
          skippedReason: "TRASK_REINDEX_TOKEN is not set; dry-run request not sent",
          request: { url: `${retrieveBaseUrl()}/reindex`, body: { dryRun: true, limit: 5 } },
        });
        process.exitCode = 1;
        break;
      }
      const result = await postJson(
        `${retrieveBaseUrl()}/reindex`,
        { dryRun: true, limit: Number.parseInt(process.env.TRASK_REINDEX_DRY_RUN_LIMIT ?? "5", 10) },
        { authorization: `Bearer ${token}` },
      );
      outputJson({ ok: result.ok, status: result.status, dryRun: true, ...result.body });
      if (!result.ok) process.exitCode = 1;
      break;
    }
    case "purge-discord-message": {
      const args = process.argv.slice(3);
      const readFlag = (flag) => {
        const index = args.indexOf(flag);
        return index >= 0 ? args[index + 1] : undefined;
      };
      const channelId = readFlag("--channel-id");
      const messageId = readFlag("--message-id");
      const guildId = readFlag("--guild-id");
      const execute = args.includes("--execute");
      if (!channelId || !messageId) {
        throw new Error("Usage: node scripts/trask_ops.mjs purge-discord-message --channel-id C --message-id M [--guild-id G] [--execute]");
      }
      const purgeArgs = [
        "scripts/trask_purge_discord_message.py",
        "--channel-id",
        channelId,
        "--message-id",
        messageId,
        ...(guildId ? ["--guild-id", guildId] : []),
        ...(execute ? [] : ["--dry-run"]),
      ];
      await run("python", purgeArgs);
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
