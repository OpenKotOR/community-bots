import { expect, test } from '@playwright/test'

test.describe.configure({ timeout: 60_000 })

const threadId = '22222222-2222-4222-8222-222222222222'
const queryId = '33333333-3333-4333-8333-333333333333'

test('polls async Trask research until complete answer renders', async ({ page }) => {
  let askCount = 0
  let threadPolls = 0
  const query = 'What is TSLPatcher used for in KOTOR modding?'

  await page.route('**/api/trask/**', async (route) => {
    const url = route.request().url()

    if (url.includes('/api/trask/models')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          models: [{ id: 'auto', label: 'Auto', provider: 'ResearchWizard fallback', recommended: true }],
        }),
      })
      return
    }

    if (url.includes('/api/trask/session')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({ loggedIn: false, oauthAvailable: false }),
      })
      return
    }

    if (url.includes('/api/trask/sources')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sources: [] }) })
      return
    }

    if (url.includes('/api/trask/history')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ history: [] }) })
      return
    }

    if (url.includes('/api/trask/ask') && route.request().method() === 'POST') {
      askCount += 1
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({
          query: {
            queryId,
            threadId,
            userId: 'qa-webui',
            query,
            status: 'pending',
            answer: null,
            sources: [],
            error: null,
            createdAt: new Date().toISOString(),
            completedAt: null,
            liveTrace: [{ at: new Date().toISOString(), phase: 'queued', detail: 'Holocron retrieval queued…' }],
          },
        }),
      })
      return
    }

    if (url.includes(`/api/trask/thread/${threadId}`)) {
      threadPolls += 1
      const complete = threadPolls >= 3
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          history: [
            {
              queryId,
              threadId,
              userId: 'qa-webui',
              query,
              status: complete ? 'complete' : 'pending',
              answer: complete
                ? 'TSLPatcher applies 2DA, TLK, and GFF patches for KotOR mods [1].\n\nSources\n1. Deadly Stream - https://deadlystream.com/topic/tslpatcher'
                : null,
              sources: complete
                ? [{ id: 'deadlystream', name: 'Deadly Stream', url: 'https://deadlystream.com/topic/tslpatcher' }]
                : [],
              error: null,
              createdAt: new Date().toISOString(),
              completedAt: complete ? new Date().toISOString() : null,
              liveTrace: complete
                ? [
                    { at: new Date().toISOString(), phase: 'gather', detail: 'Scanning approved sources…' },
                    { at: new Date().toISOString(), phase: 'compose', detail: 'Rendering Holocron answer…' },
                  ]
                : [{ at: new Date().toISOString(), phase: 'gather', detail: 'Researching…' }],
            },
          ],
        }),
      })
      return
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'mock miss' }) })
  })

  await page.goto(`/?thread=${threadId}`, { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('log', { name: 'Holocron conversation messages' })).toBeVisible({ timeout: 20_000 })
  const input = page.locator('#question-input')
  await expect(input).toBeVisible({ timeout: 20_000 })

  await input.fill(query)
  await page.getByRole('button', { name: /submit question|send now/i }).click()

  const assistantArticle = page.getByRole('article', { name: /assistant message/i }).last()
  await expect(assistantArticle).toBeVisible({ timeout: 15_000 })
  await expect(assistantArticle.getByText(/TSLPatcher applies/i)).toBeVisible({ timeout: 45_000 })
  await expect(assistantArticle.getByText(/^Thinking$/i)).toHaveCount(0)
  await expect(page.getByText('Deadly Stream').first()).toBeVisible()

  expect(askCount).toBe(1)
  expect(threadPolls).toBeGreaterThanOrEqual(3)
})
