import { expect, type Locator, type Page, test } from '@playwright/test'

test.describe.configure({ timeout: 60_000 })

const seededThreadId = '11111111-1111-4111-8111-111111111111'

const seededConversation = {
  id: `holocron-${seededThreadId}`,
  title: 'Holocron frontend regression',
  createdAt: 1_735_689_600_000,
  updatedAt: 1_735_689_660_000,
  messages: [
    {
      id: 'user-1',
      role: 'user',
      content: 'How do I verify the Holocron response card?',
      timestamp: 1_735_689_600_000,
    },
    {
      id: 'assistant-complete',
      role: 'assistant',
      content: 'Completed answer from Trask with an inline citation [1].',
      expandedContent: 'Completed answer from Trask with an inline citation [1].',
      timestamp: 1_735_689_610_000,
      researchStatus: 'complete',
      sources: [
        { name: 'Deadly Stream Guide', url: 'https://deadlystream.com/topic/answer', confidence: 1 },
      ],
      agentResults: [
        {
          agentName: 'Trask',
          source: 'holocron',
          snippet: 'Completed answer from Trask with an inline citation.',
          confidence: 1,
          status: 'complete',
          retrievedContent: 'Completed answer from Trask with an inline citation [1].',
        },
      ],
    },
    {
      id: 'assistant-expandable',
      role: 'assistant',
      content: 'Short archival summary.',
      expandedContent: 'Short archival summary. Expanded archival detail that should only appear after expanding the card.',
      timestamp: 1_735_689_620_000,
      researchStatus: 'complete',
    },
    {
      id: 'assistant-source-only',
      role: 'assistant',
      content: '',
      timestamp: 1_735_689_630_000,
      researchStatus: 'failed',
      sources: [
        { name: 'PCGamingWiki KOTOR', url: 'https://www.pcgamingwiki.com/wiki/Star_Wars:_Knights_of_the_Old_Republic', confidence: 1 },
      ],
    },
    {
      id: 'assistant-retrieval',
      role: 'assistant',
      content: 'Legacy retrieval card with failed source details.',
      timestamp: 1_735_689_640_000,
      agentResults: [
        { agentName: 'Archive mirror', source: 'holocron', snippet: 'ok', confidence: 0.9, status: 'complete' },
        { agentName: 'Offline forum cache', source: 'holocron', snippet: 'offline', confidence: 0, status: 'failed' },
      ],
    },
  ],
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/trask/**', async (route) => {
    const url = route.request().url()
    if (url.includes('/api/trask/models')) {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          models: [
            { id: 'auto', label: 'Auto', provider: 'ResearchWizard fallback', recommended: true },
          ],
        }),
      })
      return
    }

    if (url.includes('/api/trask/history') || url.includes('/api/trask/thread/')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ history: [] }) })
      return
    }

    if (url.includes('/api/trask/session')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ authenticated: false }) })
      return
    }

    if (url.includes('/api/trask/sources')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ sources: [] }) })
      return
    }

    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'mocked endpoint' }) })
  })

  await page.addInitScript((conversation) => {
    window.localStorage.clear()
    window.localStorage.setItem('theme', JSON.stringify('dark'))
    window.localStorage.setItem('qa-conversations-v2', JSON.stringify([conversation]))
    window.localStorage.setItem('active-conversation-id', JSON.stringify(conversation.id))
    window.localStorage.setItem('holocron-trask-model', JSON.stringify('auto'))
    window.localStorage.setItem('holocron-sidebar-collapsed', JSON.stringify(true))
  }, seededConversation)
})

async function openSeededConversation(page: Page) {
  await page.goto(`/?thread=${seededThreadId}`)
  await expect(page.getByRole('log', { name: 'Holocron conversation messages' })).toBeVisible()
  await expect(page.getByText('Completed answer from Trask').first()).toBeVisible()
  await expect(page.getByRole('article', { name: 'Assistant message' })).toHaveCount(4, { timeout: 15_000 })
}

function parseRgb(value: string): { r: number; g: number; b: number; a: number } {
  const oklchMatch = value.match(/oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+))?\s*\)/)
  if (oklchMatch) {
    const lightness = oklchMatch[1].endsWith('%') ? Number.parseFloat(oklchMatch[1]) / 100 : Number.parseFloat(oklchMatch[1])
    const chroma = Number.parseFloat(oklchMatch[2])
    const hue = Number.parseFloat(oklchMatch[3]) * Math.PI / 180
    return oklabToRgb(lightness, chroma * Math.cos(hue), chroma * Math.sin(hue), Number.parseFloat(oklchMatch[4] ?? '1'))
  }

  const oklabMatch = value.match(/oklab\(\s*([\d.]+%?)\s+([-\d.]+)\s+([-\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/)
  if (oklabMatch) {
    const lightness = oklabMatch[1].endsWith('%') ? Number.parseFloat(oklabMatch[1]) / 100 : Number.parseFloat(oklabMatch[1])
    return oklabToRgb(lightness, Number.parseFloat(oklabMatch[2]), Number.parseFloat(oklabMatch[3]), Number.parseFloat(oklabMatch[4] ?? '1'))
  }

  const match = value.match(/rgba?\(([^)]+)\)/)
  if (!match) return { r: 0, g: 0, b: 0, a: 1 }
  const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
  return { r: parts[0] ?? 0, g: parts[1] ?? 0, b: parts[2] ?? 0, a: parts[3] ?? 1 }
}

function oklabToRgb(lightness: number, a: number, b: number, alpha = 1): { r: number; g: number; b: number; a: number } {
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b
  const sPrime = lightness - 0.0894841775 * a - 1.2914855480 * b
  const l = lPrime ** 3
  const m = mPrime ** 3
  const s = sPrime ** 3
  const linearR = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
  const linearG = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
  const linearB = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  const toSrgb = (channel: number) => {
    const clamped = Math.min(1, Math.max(0, channel))
    return Math.round((clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * (clamped ** (1 / 2.4)) - 0.055) * 255)
  }
  return { r: toSrgb(linearR), g: toSrgb(linearG), b: toSrgb(linearB), a: alpha }
}

function luminance({ r, g, b }: { r: number; g: number; b: number }) {
  const linear = [r, g, b].map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

async function contrastRatio(locator: Locator) {
  await locator.waitFor({ state: 'visible', timeout: 10_000 })
  const styles = await locator.evaluate((element) => {
    const textColor = getComputedStyle(element).color
    const alphaOf = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/)
      if (!match) return 1
      const parts = match[1].split(',').map((part) => Number.parseFloat(part.trim()))
      return parts[3] ?? 1
    }
    let backgroundColor = getComputedStyle(element).backgroundColor
    let current: Element | null = element
    while (current && alphaOf(backgroundColor) < 0.05) {
      current = current.parentElement
      if (current) backgroundColor = getComputedStyle(current).backgroundColor
    }
    return { textColor, backgroundColor }
  }, undefined, { timeout: 10_000 })
  const foreground = parseRgb(styles.textColor)
  const background = parseRgb(styles.backgroundColor)
  const light = Math.max(luminance(foreground), luminance(background))
  const dark = Math.min(luminance(foreground), luminance(background))
  return (light + 0.05) / (dark + 0.05)
}

test('renders answers, sources, and only real expansion controls', async ({ page }) => {
  await openSeededConversation(page)

  await expect(page.getByText('Deadly Stream Guide').first()).toBeVisible()
  await expect(page.getByText('Trask returned source references').first()).toBeVisible()
  await expect(page.getByText('PCGamingWiki KOTOR').first()).toBeVisible()

  const completedArticle = page.getByRole('article', { name: 'Assistant message' }).filter({ hasText: 'Completed answer from Trask' }).first()
  await expect(completedArticle.getByRole('button', { name: 'Show more' })).toHaveCount(0)

  const expandableArticle = page.getByRole('article', { name: 'Assistant message' }).filter({ hasText: 'Short archival summary' }).first()
  const showMoreButton = expandableArticle.getByRole('button', { name: 'Show more' })
  await expect(showMoreButton).toBeVisible()
  await showMoreButton.click()
  await expect(expandableArticle.getByText('Expanded archival detail')).toBeVisible()
  await expect(expandableArticle.getByRole('button', { name: 'Show less' })).toBeVisible()
})

test('keeps citation chips linked to parsed sources', async ({ page }) => {
  await openSeededConversation(page)

  const completedArticle = page.getByRole('article', { name: 'Assistant message' }).filter({ hasText: 'Completed answer from Trask' }).first()
  const citationLink = completedArticle.getByRole('link', { name: '1' }).first()

  await expect(citationLink).toBeVisible()
  await expect(citationLink).toHaveAttribute('href', 'https://deadlystream.com/topic/answer')
  await expect(citationLink).toHaveAttribute('target', '_blank')
  await expect(citationLink).toHaveAttribute('rel', 'noopener noreferrer')
})

test('renders source-only assistant replies with fallback guidance', async ({ page }) => {
  await openSeededConversation(page)

  const sourceOnlyArticle = page.getByRole('article', { name: 'Assistant message' }).filter({ hasText: 'PCGamingWiki KOTOR' }).first()

  await expect(sourceOnlyArticle.getByText('Trask returned source references, but no visible answer text')).toBeVisible()
  await expect(sourceOnlyArticle.getByRole('button', { name: 'Show more' })).toHaveCount(0)
  const sourceItem = sourceOnlyArticle.getByRole('listitem').filter({ hasText: 'PCGamingWiki KOTOR' }).first()
  await expect(sourceItem).toBeVisible()
  await expect(sourceItem).toContainText('pcgamingwiki.com')
})

test('keeps dark-glass controls readable', async ({ page }) => {
  await openSeededConversation(page)

  const expandableArticle = page
    .getByRole('article', { name: 'Assistant message' })
    .filter({ hasText: 'Short archival summary' })
    .first()
  const showMore = expandableArticle.getByRole('button', { name: 'Show more' })
  await showMore.scrollIntoViewIfNeeded()
  await expect(showMore).toBeVisible()
  await expect(await contrastRatio(showMore)).toBeGreaterThanOrEqual(4.5)

  const dataBadge = page.getByText('Data').first()
  await expect(await contrastRatio(dataBadge)).toBeGreaterThanOrEqual(4.5)

  const retrievalArticle = page.getByRole('article', { name: 'Assistant message' }).filter({ hasText: 'Legacy retrieval card' }).first()
  const retrievalTrigger = retrievalArticle.getByRole('button', { name: /Show retrieval details/ })
  await expect(await contrastRatio(retrievalTrigger)).toBeGreaterThanOrEqual(4.5)

  await retrievalTrigger.click()
  const unavailableTrigger = retrievalArticle.getByRole('button', { name: /source unavailable|sources unavailable/ })
  await expect(unavailableTrigger).toBeVisible()
  await expect(await contrastRatio(unavailableTrigger)).toBeGreaterThanOrEqual(4.5)

  const modelPicker = page.getByRole('combobox', { name: 'Research model' })
  await expect(modelPicker).toBeVisible()
  await expect(modelPicker).toContainText('Auto')
  await expect(await contrastRatio(modelPicker)).toBeGreaterThanOrEqual(4.5)
})
