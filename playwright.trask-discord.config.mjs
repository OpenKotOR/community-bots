import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.dirname(fileURLToPath(import.meta.url))

/** Offline Discord /ask embed contract — golden compose harness on :4012 (no discord.com). */
export default defineConfig({
  testDir: path.join(repoRoot, 'e2e'),
  testMatch: /trask-discord-ask\.spec\.mjs$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.DISCORD_ASK_E2E_BASE_URL ?? 'http://127.0.0.1:4012',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node scripts/discord-ask-e2e-webserver.mjs',
    cwd: repoRoot,
    url: process.env.DISCORD_ASK_E2E_BASE_URL ?? 'http://127.0.0.1:4012/health',
    reuseExistingServer: process.env.DISCORD_ASK_E2E_REUSE_SERVER === '1' || !process.env.CI,
    timeout: 30_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
