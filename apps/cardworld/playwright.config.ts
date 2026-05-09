import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const packageRoot = dirname(fileURLToPath(import.meta.url));

const nakamaHost = process.env.VITE_NAKAMA_HOST ?? "127.0.0.1";
const nakamaPort = process.env.VITE_NAKAMA_PORT ?? "7350";

/** Dedicated port so e2e never reuses a human `pnpm dev:pazaak-world` on 5173 without Nakama env (that yields proxy HTTP 502 on matchmaking). */
const vitePort = process.env.PLAYWRIGHT_VITE_PORT ?? "5183";
const defaultBaseUrl = `http://127.0.0.1:${vitePort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 120_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? defaultBaseUrl,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm exec vite --host 127.0.0.1 --port ${vitePort} --strictPort`,
    cwd: packageRoot,
    env: {
      ...process.env,
      VITE_PAZAAK_BACKEND: "nakama",
      VITE_NAKAMA_HOST: nakamaHost,
      VITE_NAKAMA_PORT: nakamaPort,
    },
    url: `${defaultBaseUrl}/`,
    reuseExistingServer: process.env.PLAYWRIGHT_FORCE_NEW_WEBSERVER !== "1",
    timeout: 120_000,
  },
});
