#!/usr/bin/env node
/**
 * Build workspace packages + Holocron dist + trask-http-server for live Playwright e2e.
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ensureWorkspaceBuilt } from './lib/trask_skip_build.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vite = resolve(repoRoot, 'apps/holocron-web/node_modules/.bin/vite')

function run(cmd, args, cwd = repoRoot) {
  const result = spawnSync(cmd, args, { cwd, stdio: 'inherit', env: process.env })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

if (!existsSync(vite)) {
  console.error('Missing apps/holocron-web/node_modules/.bin/vite — run pnpm install first.')
  process.exit(1)
}

console.log('\n▶ Building workspace TypeScript (trask, trask-http, trask-http-server, …)\n')
ensureWorkspaceBuilt(repoRoot)

console.log('\n▶ Building Holocron web (Vite)\n')
run(vite, ['build'], resolve(repoRoot, 'apps/holocron-web'))

const serverMain = resolve(repoRoot, 'apps/trask-http-server/dist/main.js')
const holocronIndex = resolve(repoRoot, 'apps/holocron-web/dist/index.html')
if (!existsSync(serverMain) || !existsSync(holocronIndex)) {
  console.error('Build outputs missing:', { serverMain, holocronIndex })
  process.exit(1)
}

console.log('\n✅ Live e2e build ready.\n')
