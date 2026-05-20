import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

import { loadTraskPolicy } from '../../../packages/trask-config/dist/policy.js'
import { verificationQueriesForSurface } from '../../../packages/trask-config/dist/verification-queries.js'
import { assertAllUrlsReachable } from '../../../scripts/lib/url-verify.mjs'

/**
 * Holocron functional e2e: real browser against trask-http-server + built Holocron.
 * Uses expert verification queries (not golden indexer fixtures). Exercises POST /ask → 202 →
 * GET /thread poll → rendered answer + reachable https citations (no API mocks).
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 })

const RESEARCH_QUERIES = verificationQueriesForSurface('holocron').map((entry) => ({
  question: entry.question,
  expectPattern: entry.expectRe,
  sourcePattern: entry.sourceRe,
  forbidPattern: entry.forbidRe,
}))

const MIN_HTTPS_SOURCES = loadTraskPolicy().holocron.minHttpsSources

const EXPECTED_INDEXER_HOST = (() => {
  const raw = process.env.TRASK_INDEXER_BASE_URL ?? 'http://127.0.0.1:8787'
  try {
    return new URL(raw).host
  } catch {
    return '127.0.0.1:8787'
  }
})()

async function waitForHolocronReady(page: Page, threadId = randomUUID()) {
  await page.goto(`/?thread=${threadId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /HOLOCRON ARCHIVE/i })).toBeVisible({ timeout: 45_000 })

  const input = page.getByRole('textbox', { name: 'Question input' })
  await expect(input).toBeVisible({ timeout: 45_000 })
  await expect(input).toBeEnabled({ timeout: 60_000 })
  await expect(input).not.toHaveAttribute('placeholder', /Preparing thread/i)
  return threadId
}

async function assertLiveTraceHasIndexerDiagnostics(
  request: import('@playwright/test').APIRequestContext,
  baseURL: string,
  threadId: string,
) {
  const res = await request.get(`${baseURL}/api/trask/thread/${encodeURIComponent(threadId)}`)
  expect(res.ok(), `thread poll failed: ${res.status()}`).toBeTruthy()
  const body = (await res.json()) as {
    history?: Array<{
      status?: string
      groundingStatus?: string
      liveTrace?: Array<{
        phase?: string
        detail?: string
        diag?: Record<string, unknown>
        urls?: string[]
      }>
    }>
  }
  const completed = (body.history ?? []).filter((row) => row.status === 'complete').pop()
  expect(completed, 'expected a completed query on thread').toBeTruthy()
  expect(
    completed?.groundingStatus,
    'completed query should record groundingStatus',
  ).toMatch(/^(grounded|failed|partial)$/)
  const trace = completed?.liveTrace ?? []
  expect(trace.length, 'liveTrace should include multiple steps').toBeGreaterThanOrEqual(4)
  const hasIndexer =
    trace.some((step) => {
      const indexer = step.diag?.indexer
      return typeof indexer === 'string' && indexer.includes(EXPECTED_INDEXER_HOST)
    })
    || trace.some((step) => step.detail?.includes(EXPECTED_INDEXER_HOST))
  expect(
    hasIndexer,
    `liveTrace should record indexer URL host (${EXPECTED_INDEXER_HOST})`,
  ).toBeTruthy()
  const hasPassageSignal = trace.some(
    (step) =>
      (typeof step.diag?.passages === 'number' && (step.diag.passages as number) > 0)
      || (step.urls?.length ?? 0) > 0,
  )
  expect(hasPassageSignal, 'liveTrace should record passage or URL retrieve detail').toBeTruthy()
}

async function submitQueryAndAwaitAnswer(page: Page, question: string) {
  const input = page.getByRole('textbox', { name: 'Question input' })
  await input.fill(question)
  const submit = page.getByRole('button', { name: /submit question|send now/i })
  await expect(submit).toBeEnabled({ timeout: 10_000 })
  await submit.click()

  await expect(page.getByRole('article', { name: /user message/i }).last()).toContainText(question, {
    timeout: 20_000,
  })

  const assistantArticle = page.getByRole('article', { name: /assistant message/i }).last()
  await expect(assistantArticle).toBeVisible({ timeout: 30_000 })
  await expect(assistantArticle.getByText(/^Thinking$/i)).toHaveCount(0, { timeout: 200_000 })

  const answerRegion = assistantArticle.getByLabel('Answer')
  await expect(answerRegion).toBeVisible({ timeout: 30_000 })
  const bodyText = (await answerRegion.innerText()).trim()
  const rawText = (await assistantArticle.innerText()).trim()
  return { assistantArticle, bodyText, rawText }
}

function extractHttpsUrls(text: string): string[] {
  const matches = text.match(/https:\/\/[^\s)\]]+/gu)
  return matches ? [...new Set(matches.map((url) => url.replace(/[.,;]+$/u, '')))] : []
}

function assertSubstantiveAnswer(
  bodyText: string,
  sourcesText: string,
  {
    expectPattern,
    sourcePattern,
    forbidPattern,
  }: (typeof RESEARCH_QUERIES)[number],
) {
  expect(bodyText.length, 'answer body should be substantive').toBeGreaterThan(60)
  expect(bodyText, 'answer should match topic').toMatch(expectPattern)
  const bodyForTopicCheck = bodyText.replace(/https:\/\/[^\s)\]]+/gu, '')
  if (forbidPattern) {
    expect(bodyForTopicCheck, 'answer should not bleed unrelated topics').not.toMatch(forbidPattern)
  }
  expect(bodyText, 'should not be bare synthesis failure stub').not.toMatch(
    /^i could not complete live archive synthesis[^.]*\.\s*$/iu,
  )
  expect(bodyText, 'should use grammatical prose, not stub headings').not.toMatch(/^Answer for:/im)
  expect(sourcesText, 'sources should stay aligned with the question').toMatch(sourcePattern)
  expect(sourcesText, 'must not cite repo-local technical-reference URLs').not.toMatch(/local:\/\/technical-reference/i)
}

function countHttpsUrls(text: string): number {
  return extractHttpsUrls(text).length
}

test.beforeAll(async ({ request, baseURL }) => {
  const health = await request.get(`${baseURL}/api/trask/session`)
  expect(health.ok(), `trask session probe failed: ${health.status()}`).toBeTruthy()
})

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    if (!sessionStorage.getItem('__holocron_e2e_storage_initialized__')) {
      localStorage.clear()
      sessionStorage.clear()
      sessionStorage.setItem('__holocron_e2e_storage_initialized__', '1')
    }
  })
})

for (const [index, querySpec] of RESEARCH_QUERIES.entries()) {
  test(`research ${index + 1}: ${querySpec.question.slice(0, 48)}…`, async ({ page, request, baseURL }) => {
    const { question } = querySpec
    const threadId = await waitForHolocronReady(page)
    const { assistantArticle, bodyText } = await submitQueryAndAwaitAnswer(page, question)
    await assertLiveTraceHasIndexerDiagnostics(request, baseURL!, threadId)

    const thoughtProcess = page.getByRole('button', { name: /thought process/i })
    await expect(thoughtProcess).toBeVisible()
    await expect(thoughtProcess).toContainText(/\d+\s+steps?/i)

    const citationLink = assistantArticle.getByRole('link').filter({ hasText: /^[1-9]\d*$/ }).first()
    const sourcesRegion = assistantArticle.locator('[aria-label="Sources"]')
    const httpsInSources = sourcesRegion.locator('a[href^="https://"]')
    const hasCitationLink = (await citationLink.count()) > 0
    const hasSourcesPanel = (await sourcesRegion.count()) > 0
    const bodyHasHttps = /https:\/\/[^\s)]+/.test(bodyText)
    const sourcesText = hasSourcesPanel ? (await sourcesRegion.innerText()).trim() : bodyText

    expect(bodyText, 'answer region must not include thought-process trace copy').not.toMatch(
      /Holocron retrieval queued|^\s*QUEUED\s*$/im,
    )

    assertSubstantiveAnswer(bodyText, sourcesText, querySpec)

    const httpsCount = Math.max(
      await httpsInSources.count(),
      countHttpsUrls(sourcesText),
      countHttpsUrls(bodyText),
    )
    expect(httpsCount, `expected at least ${MIN_HTTPS_SOURCES} distinct https:// sources`).toBeGreaterThanOrEqual(
      MIN_HTTPS_SOURCES,
    )
    expect(hasCitationLink || hasSourcesPanel, 'expected clickable citation or Sources panel').toBeTruthy()
    expect(bodyHasHttps || httpsCount > 0, 'expected https URLs in answer or Sources panel').toBeTruthy()

    const citedUrls = extractHttpsUrls(`${bodyText}\n${sourcesText}`).filter((url) => {
      try {
        const host = new URL(url).hostname.replace(/^www\./i, '')
        return host !== 'openkotor.github.io'
      } catch {
        return true
      }
    })
    await assertAllUrlsReachable(citedUrls, `query ${index + 1}`)
  })
}

test('completed remote thread clears stale persisted research job on reload', async ({ page }) => {
  const threadId = randomUUID()
  const question =
    'For a custom MDL exported from Blender, which MDLOps workflow step turns it back into game-ready KotOR models?'

  await waitForHolocronReady(page, threadId)
  const { assistantArticle, bodyText } = await submitQueryAndAwaitAnswer(page, question)
  await expect(assistantArticle).toContainText(/MDLOps|model|export/i)

  const staleJob = {
    clientId: 'stale-job-mdlops',
    conversationId: `holocron-${threadId}`,
    threadId,
    question,
    assistantMessageId: 'pending-stale-job-a',
    queryType: 'general',
    state: 'submitted',
    attemptCount: 0,
    pollFailures: 0,
    createdAt: Date.now() - 2_000,
    updatedAt: Date.now() - 1_000,
    nextAttemptAt: Date.now() - 1_000,
  }

  await page.evaluate((job) => {
    localStorage.setItem('holocron-research-jobs', JSON.stringify([job]))
  }, staleJob)

  await page.reload({ waitUntil: 'domcontentloaded' })
  const reloadedAssistant = page.getByRole('article', { name: /assistant message/i }).last()
  await expect(reloadedAssistant).toContainText(/MDLOps|model|export/i, { timeout: 30_000 })
  await expect(reloadedAssistant.getByText(/^Thinking$/i)).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText(/Querying Archives\.\.\./i)).toHaveCount(0, { timeout: 30_000 })

  const persistedJobs = await page.evaluate(() => {
    const raw = localStorage.getItem('holocron-research-jobs')
    return raw ? JSON.parse(raw) : []
  })
  expect(persistedJobs, 'stale persisted research jobs should be removed after remote sync').toEqual([])
  expect(bodyText).toMatch(/MDLOps|model/i)
})
