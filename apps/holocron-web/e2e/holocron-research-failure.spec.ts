import { randomUUID } from 'node:crypto'

import { expect, test, type Page } from '@playwright/test'

/**
 * Holocron failure-path e2e: unreachable TRASK_INDEXER_BASE_URL.
 * Run via playwright.failure.config.ts (`pnpm holocron:e2e:playwright:failure`).
 * Asserts failed grounding UX and classifiable liveTrace without live retrieve/LLM.
 */

test.describe.configure({ mode: 'serial', timeout: 180_000 })

const FAILURE_QUESTION = 'What is TSLPatcher used for in KOTOR modding?'

async function waitForHolocronReady(page: Page, threadId = randomUUID()) {
  await page.goto(`/?thread=${threadId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: /HOLOCRON ARCHIVE/i })).toBeVisible({ timeout: 45_000 })

  const input = page.getByRole('textbox', { name: 'Question input' })
  await expect(input).toBeVisible({ timeout: 45_000 })
  await expect(input).toBeEnabled({ timeout: 60_000 })
  await expect(input).not.toHaveAttribute('placeholder', /Preparing thread/i)
  return threadId
}

async function submitQueryAndAwaitFailure(page: Page, question: string) {
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
  await expect(assistantArticle.getByText(/^Thinking$/i)).toHaveCount(0, { timeout: 180_000 })

  const answerRegion = assistantArticle.getByLabel('Answer', { exact: true })
  await expect(answerRegion).toBeVisible({ timeout: 30_000 })
  return { assistantArticle, bodyText: (await answerRegion.innerText()).trim() }
}

function traceShowsFailureClass(trace: Array<{ phase?: string; detail?: string; diag?: Record<string, unknown> }>) {
  return trace.some((step) => {
    const detail = String(step.detail ?? '')
    if (/timed out|failed|gather timed out|could not complete live web research/i.test(detail)) {
      return true
    }
    const diag = step.diag ?? {}
    if (diag.index_miss === true) return true
    if (typeof diag.error === 'string' && diag.error.length > 0) return true
    if (typeof diag.timeout_phase === 'string') return true
    if (typeof diag.rejected_urls === 'number' && diag.rejected_urls > 0) return true
    return false
  })
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

test('unreachable indexer: failed grounding and classifiable liveTrace', async ({ page, request, baseURL }) => {
  const threadId = await waitForHolocronReady(page)
  const { assistantArticle, bodyText } = await submitQueryAndAwaitFailure(page, FAILURE_QUESTION)

  expect(bodyText, 'failure answer should explain research could not complete').toMatch(
    /could not complete live web research|research failed|insufficient/i,
  )

  const thoughtProcess = assistantArticle.getByRole('button', { name: /thought process/i })
  await expect(thoughtProcess).toBeVisible()
  await expect(thoughtProcess).not.toContainText(/^Thinking$/i)

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
      }>
    }>
  }
  let completed = (body.history ?? []).filter((row) => row.status === 'complete').pop()
  if (!completed) {
    const fallbackRes = await request.get(`${baseURL}/api/trask/history?limit=12`)
    expect(fallbackRes.ok(), `history fallback failed: ${fallbackRes.status()}`).toBeTruthy()
    const fallbackBody = (await fallbackRes.json()) as {
      history?: Array<{
        query?: string
        status?: string
        groundingStatus?: string
        liveTrace?: Array<{
          phase?: string
          detail?: string
          diag?: Record<string, unknown>
        }>
      }>
    }
    completed = (fallbackBody.history ?? [])
      .filter((row) =>
        row.status === 'complete'
        && row.query === FAILURE_QUESTION
        && traceShowsFailureClass(row.liveTrace ?? []),
      )
      .pop()
  }
  expect(completed, 'expected a completed query record on thread').toBeTruthy()
  expect(completed?.groundingStatus, 'failed retrieve should record groundingStatus failed').toBe('failed')

  const trace = completed?.liveTrace ?? []
  expect(trace.length, 'liveTrace should include diagnostic steps').toBeGreaterThanOrEqual(2)
  expect(traceShowsFailureClass(trace), 'liveTrace should expose failure class (error, timeout, or index_miss)').toBeTruthy()
})
