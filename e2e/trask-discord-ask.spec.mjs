import { expect, test } from '@playwright/test'

/**
 * Offline Playwright gate for Discord /ask embed descriptions.
 * Mirrors verify_trask_discord_live.mjs import-smoke via static harness (no LLM).
 */

const EXPECTED_SPEC_COUNT = 5
const DISCORD_ASK_MAX_BODY_LINES = 5

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ request, baseURL }) => {
  const health = await request.get(`${baseURL}/health`)
  expect(health.ok()).toBeTruthy()
  const body = await health.json()
  expect(body.specs).toBe(EXPECTED_SPEC_COUNT)
})

test('harness lists all discord verification embeds', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /Discord \/ask import-smoke harness/i })).toBeVisible()
  await expect(page.getByRole('article')).toHaveCount(EXPECTED_SPEC_COUNT)
})

test('each embed matches Discord /ask display contract', async ({ page }) => {
  await page.goto('/')
  const articles = page.getByRole('article')
  const count = await articles.count()
  expect(count).toBe(EXPECTED_SPEC_COUNT)

  for (let i = 0; i < count; i += 1) {
    const article = articles.nth(i)
    const specId = await article.getAttribute('data-spec-id')
    const expectPattern = await article.getAttribute('data-expect-pattern')
    expect(specId, `article ${i} missing data-spec-id`).toBeTruthy()
    expect(expectPattern, `article ${i} missing data-expect-pattern`).toBeTruthy()

    const display = (await article.locator('.embed-description').innerText()).trim()
    const question = (await article.getByRole('heading', { level: 2 }).innerText()).trim()

    expect(display.length, `${specId}: empty embed`).toBeGreaterThan(40)
    expect(display, `${specId}: on-topic`).toMatch(new RegExp(expectPattern, 'i'))
    expect(display, `${specId}: no Sources block`).not.toMatch(/^\s*Sources\b/im)
    expect(display, `${specId}: no Answer for prefix`).not.toMatch(/\bAnswer for:/i)

    const nonEmptyLines = display.split(/\r?\n/).filter((line) => line.trim().length > 0)
    expect(
      nonEmptyLines.length,
      `${specId}: line count ≤ ${DISCORD_ASK_MAX_BODY_LINES}`,
    ).toBeLessThanOrEqual(DISCORD_ASK_MAX_BODY_LINES)

    const inlineLinks = [...display.matchAll(/\]\(https:\/\/[^)]+\)/g)]
    expect(inlineLinks.length, `${specId}: inline https links`).toBeGreaterThanOrEqual(2)
    expect(question.length, `${specId}: question heading`).toBeGreaterThan(10)
  }
})
