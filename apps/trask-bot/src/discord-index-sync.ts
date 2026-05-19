import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { TraskBotConfig } from "@openkotor/config";
import type { Logger } from "@openkotor/core";

const resolveSyncScript = (repoRoot: string): string => join(repoRoot, "scripts", "trask_discord_sync.py");

const resolveRepoRoot = (): string => {
  const explicit = process.env.TRASK_REPO_ROOT?.trim();
  if (explicit) return explicit;
  return join(import.meta.dirname, "..", "..", "..");
};

export const startDiscordIndexSync = (
  config: TraskBotConfig,
  logger: Logger,
): (() => void) | undefined => {
  if (config.discordSyncIntervalMs <= 0) {
    return undefined;
  }

  const repoRoot = resolveRepoRoot();
  const script = resolveSyncScript(repoRoot);
  if (!existsSync(script)) {
    logger.warn("Discord index sync disabled: script missing.", { script });
    return undefined;
  }

  const python =
    config.researchWizard.pythonExecutable?.trim()
    || process.env.TRASK_WEB_RESEARCH_PYTHON?.trim()
    || "python3";

  let running = false;

  const runOnce = (): void => {
    if (running) {
      logger.info("Discord index sync skipped: previous run still active.");
      return;
    }
    running = true;

    const child = spawn(python, [script], {
      cwd: repoRoot,
      env: {
        ...process.env,
        TRASK_DISCORD_BOT_TOKEN: config.discord.botToken,
        TRASK_ALLOWED_GUILD_IDS: config.allowedGuildIds.join(","),
        TRASK_DISCORD_CHANNEL_BLACKLIST: config.discordChannelBlacklist.join(","),
        TRASK_INDEXER_BASE_URL: config.researchWizard.indexerBaseUrl,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeoutMs = config.researchWizard.discordSyncTimeoutMs;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs > 0) {
      killTimer = setTimeout(() => {
        logger.warn("Discord index sync timed out; sending SIGTERM.", { timeoutMs });
        child.kill("SIGTERM");
      }, timeoutMs);
      killTimer.unref?.();
    }

    child.stdout?.on("data", (chunk: Buffer | string) => {
      logger.info("Discord index sync", { line: String(chunk).trim() });
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      logger.warn("Discord index sync stderr", { line: String(chunk).trim() });
    });

    child.on("close", (code) => {
      if (killTimer) {
        clearTimeout(killTimer);
      }
      running = false;
      if (code !== 0) {
        logger.warn("Discord index sync exited with error.", { code });
      }
    });
  };

  runOnce();
  const timer = setInterval(runOnce, config.discordSyncIntervalMs);
  timer.unref?.();

  return () => clearInterval(timer);
};
