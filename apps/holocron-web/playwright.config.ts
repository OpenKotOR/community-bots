import { defineConfig, devices } from '@playwright/test'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  // vite preview is single-process; too many parallel browsers cause blank-page flakes.
  workers: process.env.CI ? 2 : 2,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4174',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 4174',
    cwd: appDir,
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
    },
  ],
})
