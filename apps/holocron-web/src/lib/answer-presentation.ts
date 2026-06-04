/**
 * Pure helpers for splitting Trask answer markdown into visible claims vs Sources.
 * Kept separate from Message.tsx for unit testing without React.
 */

import { webCitationDisplayLabel } from '@openkotor/trask/github-citation-url'

export interface SourceLike {
  name: string
  url: string
  confidence?: number
}

export interface DisplaySource extends SourceLike {
  index: number
  hostname: string
}

export interface AnswerPresentation {
  answerText: string
  hasAnswerText: boolean
  isSourceOnly: boolean
  sources: DisplaySource[]
  sourceByIndex: Map<number, DisplaySource>
}

const SOURCE_HEADING_PATTERN = /^\s*sources\s*:?\s*$/i

function isHttpUrlSchemeTerminator(ch: string): boolean {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ')' || ch === ']' || ch === '>'
}

/** Collect http(s) URLs without regex backtracking (CodeQL-safe). */
export function extractHttpUrls(text: string): string[] {
  const urls: string[] = []
  const lower = text.toLowerCase()
  let i = 0
  while (i < text.length) {
    const httpsIdx = lower.indexOf('https://', i)
    const httpIdx = lower.indexOf('http://', i)
    const start =
      httpsIdx === -1 ? httpIdx : httpIdx === -1 ? httpsIdx : Math.min(httpsIdx, httpIdx)
    if (start === -1) break
    let end = start
    while (end < text.length && !isHttpUrlSchemeTerminator(text[end]!)) end += 1
    urls.push(text.slice(start, end))
    i = end
  }
  return urls
}

function stripHttpUrls(text: string): string {
  const lower = text.toLowerCase()
  let out = ''
  let i = 0
  while (i < text.length) {
    const httpsIdx = lower.indexOf('https://', i)
    const httpIdx = lower.indexOf('http://', i)
    const start =
      httpsIdx === -1 ? httpIdx : httpIdx === -1 ? httpsIdx : Math.min(httpsIdx, httpIdx)
    if (start === -1) {
      out += text.slice(i)
      break
    }
    out += text.slice(i, start)
    let end = start
    while (end < text.length && !isHttpUrlSchemeTerminator(text[end]!)) end += 1
    i = end
  }
  return out
}

function skipAsciiWhitespace(text: string, index: number): number {
  let i = index
  while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) {
    i += 1
  }
  return i
}

/** Replace `[label](https://…)` with `label`; tolerates whitespace between `]` and `(`. */
export function stripMarkdownHttpLinks(text: string): string {
  let result = ''
  let i = 0
  while (i < text.length) {
    if (text[i] === '!' && text[i + 1] === '[') {
      const closeBracket = text.indexOf(']', i + 2)
      if (closeBracket === -1) {
        result += text[i]
        i += 1
        continue
      }
      const afterBracket = skipAsciiWhitespace(text, closeBracket + 1)
      if (text[afterBracket] !== '(') {
        result += text[i]
        i += 1
        continue
      }
      const closeParen = text.indexOf(')', afterBracket + 1)
      if (closeParen === -1) {
        result += text[i]
        i += 1
        continue
      }
      const url = text.slice(afterBracket + 1, closeParen)
      if (url.startsWith('http://') || url.startsWith('https://')) {
        i = closeParen + 1
        continue
      }
      result += text.slice(i, closeParen + 1)
      i = closeParen + 1
      continue
    }

    if (text[i] !== '[') {
      result += text[i]
      i += 1
      continue
    }
    const closeBracket = text.indexOf(']', i + 1)
    if (closeBracket === -1) {
      result += text[i]
      i += 1
      continue
    }
    const afterBracket = skipAsciiWhitespace(text, closeBracket + 1)
    if (text[afterBracket] !== '(') {
      result += text[i]
      i += 1
      continue
    }
    const closeParen = text.indexOf(')', afterBracket + 1)
    if (closeParen === -1) {
      result += text[i]
      i += 1
      continue
    }
    const url = text.slice(afterBracket + 1, closeParen)
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const label = text.slice(i + 1, closeBracket).trim()
      if (label && label !== '...') {
        result += label
      }
      i = closeParen + 1
    } else {
      result += text.slice(i, closeParen + 1)
      i = closeParen + 1
    }
  }
  return result
}

const CITATION_PLACEHOLDER_PREFIX = '\uE000CIT'
const CITATION_PLACEHOLDER_SUFFIX = '\uE001'

/** Visible answer paragraphs: strip markdown links/images; preserve `[n]` citation markers. */
export function sanitizeAnswerParagraph(text: string): string {
  const citations: string[] = []
  const withPlaceholders = text.replace(/\[(\d{1,3})\]/g, (full) => {
    citations.push(full)
    return `${CITATION_PLACEHOLDER_PREFIX}${citations.length - 1}${CITATION_PLACEHOLDER_SUFFIX}`
  })

  let t = stripMarkdownHttpLinks(withPlaceholders)
  t = stripHttpUrls(t)
  t = t
    .replace(/\)\s*\]/g, '')
    .replace(/\[\s*\]/g, '')
    .replace(/[()]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  for (let i = 0; i < citations.length; i += 1) {
    const token = `${CITATION_PLACEHOLDER_PREFIX}${i}${CITATION_PLACEHOLDER_SUFFIX}`
    t = t.split(token).join(citations[i] ?? '')
  }
  return t
}

function parseBracketCitationLine(line: string): { index: number; rest: string } | null {
  if (!line.startsWith('[')) return null
  const close = line.indexOf(']', 1)
  if (close <= 1) return null
  const num = line.slice(1, close)
  if (!/^\d{1,3}$/.test(num)) return null
  const rest = line.slice(close + 1).trimStart()
  return { index: Number(num), rest }
}

function parseNumberedSourceLine(line: string): { index: number; rest: string } | null {
  const match = /^(\d{1,3})\.\s+/u.exec(line)
  if (!match) return null
  return { index: Number(match[1]), rest: line.slice(match[0].length) }
}

function cleanUrl(raw: string): string {
  return raw.trim().replace(/[.,;:]+$/g, '')
}

function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.replace(/^https?:\/\//, '').split('/')[0] || url
  }
}

function formatSourceDisplayName(name: string, url: string): string {
  if (!url) return name
  const label = webCitationDisplayLabel(url, name)
  return label.trim() || name
}

export function sourceKey(source: Pick<SourceLike, 'name' | 'url'>): string {
  const url = source.url?.trim().toLowerCase()
  if (url) return `url:${url}`
  return `name:${source.name.trim().toLowerCase()}`
}

function stripSourceNoise(text: string): string {
  let t = stripMarkdownHttpLinks(text)
  t = stripHttpUrls(t)
  return t
    .replace(/[()[\]]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function isNumberedBibliographyLine(line: string): boolean {
  const trimmed = line.trim()
  if (!parseNumberedSourceLine(trimmed)) return false
  return extractHttpUrls(trimmed).length > 0 || trimmed.length > 24
}

/**
 * When the model omits a `Sources` heading, peel trailing `1. …` bibliography lines into the source block.
 */
export function peelEmbeddedNumberedSources(normalized: string): { answerText: string; sourceText: string } {
  const lines = normalized.split('\n')
  let firstNumbered = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (isNumberedBibliographyLine(lines[i] ?? '')) {
      firstNumbered = i
      break
    }
  }
  if (firstNumbered < 0) {
    return { answerText: normalized, sourceText: '' }
  }

  if (firstNumbered === 0) {
    let numberedCount = 0
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      if (parseNumberedSourceLine(trimmed)) numberedCount += 1
    }
    if (numberedCount >= 2) {
      return { answerText: '', sourceText: normalized }
    }
    return { answerText: normalized, sourceText: '' }
  }

  let numberedCount = 0
  for (let i = firstNumbered; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim()
    if (!line) continue
    if (parseNumberedSourceLine(line)) {
      numberedCount += 1
      continue
    }
    if (numberedCount >= 2) break
    numberedCount = 0
    break
  }

  if (numberedCount < 2) {
    return { answerText: normalized, sourceText: '' }
  }

  const answerLines = lines.slice(0, firstNumbered)
  const sourceLines = lines.slice(firstNumbered)
  const answerText = answerLines.join('\n').trim()
  if (!answerText) {
    return { answerText: '', sourceText: sourceLines.join('\n').trim() }
  }
  return {
    answerText,
    sourceText: sourceLines.join('\n').trim(),
  }
}

export function splitAnswerFromSourceSection(content: string): { answerText: string; sourceText: string } {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  const lines = normalized.split('\n')
  const sourceHeadingIndex = lines.findIndex((line) => SOURCE_HEADING_PATTERN.test(line))

  if (sourceHeadingIndex === -1) {
    return peelEmbeddedNumberedSources(normalized)
  }

  return {
    answerText: lines.slice(0, sourceHeadingIndex).join('\n').trim(),
    sourceText: lines.slice(sourceHeadingIndex + 1).join('\n').trim(),
  }
}

function parseSourcesFromText(sourceText: string): DisplaySource[] {
  if (!sourceText.trim()) return []

  const entries: Array<{ index: number; body: string[] }> = []
  for (const rawLine of sourceText.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    const citation = parseBracketCitationLine(line)
    if (citation) {
      entries.push({ index: citation.index, body: [citation.rest] })
      continue
    }

    const numbered = parseNumberedSourceLine(line)
    if (numbered) {
      entries.push({ index: numbered.index, body: [numbered.rest] })
      continue
    }

    const lastEntry = entries.length > 0 ? entries[entries.length - 1] : undefined
    lastEntry?.body.push(line)
  }

  return entries
    .map((entry) => {
      const body = entry.body.join(' ').trim()
      const urls = extractHttpUrls(body)
      const url = cleanUrl(urls[0] ?? '')
      const name = formatSourceDisplayName(stripSourceNoise(body) || '', url)
        || (url ? sourceHostname(url) : `Source ${entry.index}`)

      if (!url && !name) return null
      return {
        index: entry.index,
        name,
        url,
        confidence: 1,
        hostname: url ? sourceHostname(url) : '',
      } satisfies DisplaySource
    })
    .filter((source): source is DisplaySource => Boolean(source))
}

export function buildAnswerPresentation(content: string, explicitSources: SourceLike[] = []): AnswerPresentation {
  const { answerText, sourceText } = splitAnswerFromSourceSection(content)
  let parsedSources = parseSourcesFromText(sourceText)
  let visibleAnswerText = answerText

  if (sourceText && parsedSources.length === 0) {
    visibleAnswerText = content.replace(/\r\n/g, '\n').trim()
    parsedSources = []
  }
  const merged: DisplaySource[] = []
  const sourceByKey = new Map<string, number>()

  const addSource = (source: DisplaySource) => {
    const key = sourceKey(source)
    const existingIndex = sourceByKey.get(key)
    if (existingIndex !== undefined) {
      const existing = merged[existingIndex]
      if (existing && !existing.url && source.url) {
        merged[existingIndex] = source
      }
      return
    }

    sourceByKey.set(key, merged.length)
    merged.push(source)
  }

  parsedSources.forEach((source) => {
    addSource(source)
  })

  explicitSources.forEach((source, idx) => {
    const candidate: DisplaySource = {
      ...source,
      index: idx + 1,
      url: cleanUrl(source.url),
      hostname: source.url ? sourceHostname(source.url) : '',
      confidence: source.confidence ?? 1,
    }
    const explicitKey = sourceKey(candidate)
    const existingByKey = sourceByKey.get(explicitKey)
    const existingByIndex = merged.findIndex((existing) => existing.index === candidate.index)
    const existingIndex = existingByKey ?? (existingByIndex >= 0 ? existingByIndex : undefined)

    if (existingIndex !== undefined) {
      const existing = merged[existingIndex]
      if (!existing) return
      merged[existingIndex] = {
        ...existing,
        name: existing.name || candidate.name,
        url: existing.url || candidate.url,
        hostname: existing.hostname || candidate.hostname,
      }
      return
    }

    if (parsedSources.length === 0) {
      addSource(candidate)
    }
  })

  const sources = merged.map((source, idx) => ({
    ...source,
    index: Number.isFinite(source.index) && source.index > 0 ? source.index : idx + 1,
    name: formatSourceDisplayName(source.name, source.url),
    hostname: source.hostname || (source.url ? sourceHostname(source.url) : ''),
  }))
  const sourceByIndex = new Map(sources.map((source) => [source.index, source]))
  const normalizedAnswerText = visibleAnswerText.trim()

  return {
    answerText: normalizedAnswerText,
    hasAnswerText: normalizedAnswerText.length > 0,
    isSourceOnly: !normalizedAnswerText && sources.length > 0,
    sources,
    sourceByIndex,
  }
}
