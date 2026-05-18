import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

/**
 * Holocron functional e2e: real browser against trask-http-server + built Holocron.
 * Exercises POST /ask → 202 → GET /thread poll → rendered answer + Sources (no API mocks).
 */

test.describe.configure({ mode: 'serial', timeout: 240_000 })

const RESEARCH_QUERIES = [
  {
    question: 'What is TSLPatcher used for in KOTOR modding?',
    expectPattern: /TSLPatcher|2DA|GFF|TLK|patch/i,
    sourcePattern: /tslpatcher|technical reference|deadlystream|lucasforums|kotor\.neocities|github/i,
  },
  {
    question: 'How do I troubleshoot KOTOR widescreen resolution issues on PC?',
    expectPattern: /widescreen|resolution|HUD|aspect/i,
    sourcePattern: /widescreen|resolution|technical reference|deadlystream|lucasforums|pcgamingwiki|kotor\.neocities/i,
  },
  {
    question: 'What is MDLOps used for in the KOTOR toolchain?',
    expectPattern: /MDLOps|MDL|model/i,
    sourcePattern: /mdlops|technical reference|mdledit|kotormax|kotorblender|github|kotor\.neocities/i,
  },
  {
    question: 'Where are Knights of the Old Republic save files stored on Windows?',
    expectPattern: /save|Saves|Windows|profile|KOTOR/i,
    sourcePattern: /save|windows|technical reference|deadlystream|lucasforums|pcgamingwiki|kotor\.neocities/i,
  },
  {
    question: 'What does the reone project provide for Odyssey engine work?',
    expectPattern: /reone|Odyssey|engine|open.?source/i,
    sourcePattern: /reone|technical reference|github|xoreos|engine/i,
  },
] as const

const SOURCE_SIGNAL_RE = /Sources|deadlystream\.com|strategywiki|pcgamingwiki|https?:\/\/|local:\/\/technical-reference/i

async function waitForHolocronReady(page: Page, threadId = randomUUID()) {
  await page.goto(`/?thread=${threadId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /HOLOCRON ARCHIVE/i })).toBeVisible({ timeout: 45_000 })

  const input = page.getByRole('textbox', { name: 'Question input' })
  await expect(input).toBeVisible({ timeout: 45_000 })
  await expect(input).toBeEnabled({ timeout: 60_000 })
  await expect(input).not.toHaveAttribute('placeholder', /Preparing thread/i)
  return threadId
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

  const bodyText = (await assistantArticle.innerText()).trim()
  return { assistantArticle, bodyText }
}

function assertSubstantiveAnswer(
  bodyText: string,
  sourcesText: string,
  {
    expectPattern,
    sourcePattern,
  }: (typeof RESEARCH_QUERIES)[number],
) {
  expect(bodyText.length, 'answer body should be substantive').toBeGreaterThan(60)
  expect(bodyText, 'answer should match topic').toMatch(expectPattern)
  expect(bodyText, 'should not be bare synthesis failure stub').not.toMatch(
    /^i could not complete live archive synthesis[^.]*\.\s*$/iu,
  )
  expect(bodyText, 'should include sources or https links').toMatch(SOURCE_SIGNAL_RE)
  expect(sourcesText, 'sources should stay aligned with the question').toMatch(sourcePattern)
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
  test(`research ${index + 1}: ${querySpec.question.slice(0, 48)}…`, async ({ page }) => {
    const { question } = querySpec
    await waitForHolocronReady(page)
    const { assistantArticle, bodyText } = await submitQueryAndAwaitAnswer(page, question)

    const citationLink = assistantArticle.getByRole('link').filter({ hasText: /^[1-9]\d*$/ }).first()
    const sourcesRegion = assistantArticle.locator('[aria-label="Sources"]')
    const httpsInSources = sourcesRegion.locator('a[href^="https://"]')
    const hasCitationLink = (await citationLink.count()) > 0
    const hasSourcesPanel = (await sourcesRegion.count()) > 0
    const bodyHasHttps = /https:\/\/[^\s)]+/.test(bodyText)
    const sourcesText = hasSourcesPanel ? (await sourcesRegion.innerText()).trim() : bodyText

    assertSubstantiveAnswer(bodyText, sourcesText, querySpec)

    expect(hasCitationLink || hasSourcesPanel, 'expected clickable citation or Sources panel').toBeTruthy()
    expect(
      (await httpsInSources.count()) > 0 || bodyHasHttps || hasCitationLink || hasSourcesPanel,
      'expected https source, inline https URL, citation, or Sources panel',
    ).toBeTruthy()
  })
}

test('completed remote thread clears stale persisted research job on reload', async ({ page }) => {
  const threadId = randomUUID()
  const question = 'What is MDLOps used for in the KOTOR toolchain?'

  await waitForHolocronReady(page, threadId)
  const { assistantArticle, bodyText } = await submitQueryAndAwaitAnswer(page, question)
  await expect(assistantArticle).toContainText(/MDLOps|model conversion/i)

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
  await expect(reloadedAssistant).toContainText(/MDLOps|model conversion/i, { timeout: 30_000 })
  await expect(reloadedAssistant.getByText(/^Thinking$/i)).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText(/Querying Archives\.\.\./i)).toHaveCount(0, { timeout: 30_000 })

  const persistedJobs = await page.evaluate(() => {
    const raw = localStorage.getItem('holocron-research-jobs')
    return raw ? JSON.parse(raw) : []
  })
  expect(persistedJobs, 'stale persisted research jobs should be removed after remote sync').toEqual([])
  expect(bodyText).toMatch(/MDLOps|model/i)
})
