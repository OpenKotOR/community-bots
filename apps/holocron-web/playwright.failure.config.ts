import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const appDir = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = path.resolve(appDir, '..', '..')

const failurePort = process.env.TRASK_HTTP_PORT ?? '4011'
const failureBaseUrl = process.env.HOLOCRON_E2E_BASE_URL ?? `http://127.0.0.1:${failurePort}`

/** Failure-path e2e: unreachable indexer (HOLOCRON_E2E_FAILURE_MODE=1). No Worker/indexer bootstrap.
 * Default :4011 so a live trask_live_stack on :4010 can stay up during local failure runs. */
export default defineConfig({
  testDir: path.resolve(appDir, 'e2e'),
  testMatch: /holocron-research-failure\.spec\.ts$/,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: failureBaseUrl,
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'bash scripts/holocron-e2e-webserver.sh',
    cwd: repoRoot,
    url: failureBaseUrl,
    reuseExistingServer: process.env.HOLOCRON_REUSE_SERVER === '1' || !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      HOLOCRON_E2E_FAILURE_MODE: '1',
      TRASK_QA_GROUNDING: '1',
      TRASK_WEB_ALLOW_ANONYMOUS: '1',
      TRASK_HTTP_PORT: failurePort,
      TRASK_SKIP_CITATION_URL_VERIFY: '1',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
  ],
})
