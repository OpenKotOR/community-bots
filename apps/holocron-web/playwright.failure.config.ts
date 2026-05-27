import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const appDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(appDir, '..', '..')

/** Failure-path e2e: Holocron with unreachable retrieve Worker (no API mocks). */
export default defineConfig({
  testDir: './e2e',
  testMatch: 'holocron-research-failure.spec.ts',
  timeout: 180_000,
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
    command: 'HOLOCRON_E2E_FAILURE_MODE=1 bash scripts/holocron-e2e-webserver.sh',
    cwd: repoRoot,
    url: process.env.HOLOCRON_E2E_BASE_URL ?? 'http://127.0.0.1:4010',
    reuseExistingServer: process.env.HOLOCRON_REUSE_SERVER === '1' && !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'chromium-failure',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
  ],
})
