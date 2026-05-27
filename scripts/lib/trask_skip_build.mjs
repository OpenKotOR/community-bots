import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_WORKSPACE_BUILD_MARKERS = [
  "packages/trask/dist/discord-reply-format.js",
  "packages/trask/dist/discord-reply-format.test.js",
  "packages/trask-config/dist/golden-queries.js",
  "apps/trask-http-server/dist/main.js",
];

/**
 * Run `pnpm build` unless TRASK_SKIP_BUILD=1 and required dist artifacts exist.
 */
export function ensureWorkspaceBuilt(repoRoot, markers = DEFAULT_WORKSPACE_BUILD_MARKERS) {
  if (process.env.TRASK_SKIP_BUILD === "1") {
    for (const rel of markers) {
      const abs = join(repoRoot, rel);
      if (!existsSync(abs)) {
        console.error(`TRASK_SKIP_BUILD=1 but missing ${rel} — run pnpm build first.`);
        process.exit(1);
      }
    }
    console.error("TRASK_SKIP_BUILD=1 — skipping workspace TypeScript build");
    return;
  }

  const result = spawnSync("pnpm", ["build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
