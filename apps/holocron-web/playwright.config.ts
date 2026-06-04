import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const appDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(appDir, '..', '..')

/** Functional e2e: real trask-http-server + Holocron dist (no /api/trask mocks).
 * testMatch: holocron-research.spec.ts (5 canonical expert queries + reload test).
 * Restored in LFG pass 2 (plan 118) via git resurrection from pre-c47c52f; tolerance echo removed from root package.json.
 * Failure spec (holocron-research-failure.spec.ts) remains for negative paths but is not matched by current testMatch.
 */
export default defineConfig({
  testDir: path.resolve(appDir, 'e2e'),
  testMatch: /holocron-research\.spec\.ts$/,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.HOLOCRON_E2E_BASE_URL ?? 'http://127.0.0.1:4010',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'bash scripts/holocron-e2e-webserver.sh',
    cwd: repoRoot,
    url: process.env.HOLOCRON_E2E_BASE_URL ?? 'http://127.0.0.1:4010',
    reuseExistingServer: process.env.HOLOCRON_REUSE_SERVER === '1' || !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // CI: smaller headless-shell install (full chrome zip extract was timing out on GHA).
        ...(process.env.CI ? { channel: 'chromium-headless-shell' as const } : {}),
        viewport: { width: 1366, height: 900 },
      },
    },
  ],
})
