import http from 'node:http'
import { randomUUID } from 'node:crypto'

const PORT = Number.parseInt(process.env.PORT ?? process.env.TRASK_HTTP_PORT ?? '7860', 10)

const STOPWORDS = new Set([
  'what',
  'where',
  'when',
  'which',
  'who',
  'how',
  'used',
  'use',
  'usedfor',
  'does',
  'the',
  'and',
  'for',
  'with',
  'from',
  'into',
  'about',
  'that',
  'this',
  'game',
  'games',
  'star',
  'wars',
  'knights',
  'old',
  'republic',
  'kotor',
  'pc',
])

const REFERENCES = [
  {
    slug: 'tslpatcher',
    title: 'TSLPatcher - KOTOR mod installer',
    summary:
      'TSLPatcher is the standard KotOR and TSL mod installer. Mod authors use it to patch 2DA, GFF, TLK, NSS, and related game data in place so a mod can merge changes into an existing installation instead of overwriting whole files.',
    tags: ['tooling', 'modding', 'tslpatcher', 'installer', '2da', 'gff', 'tlk', 'nss'],
    aliases: ['tslpatcher'],
  },
  {
    slug: 'mdlops',
    title: 'MDLOps - KOTOR model conversion tool',
    summary:
      'MDLOps is a KotOR model conversion utility used to inspect, decompile, and rebuild MDL and MDX models. Modders use it in the asset pipeline when converting Odyssey engine models between editable formats and game-ready binaries.',
    tags: ['tooling', 'mdlops', 'models', 'conversion', 'mdx', 'mdl', 'odyssey'],
    aliases: ['mdlops'],
  },
  {
    slug: 'widescreen',
    title: 'KOTOR widescreen troubleshooting on PC',
    summary:
      'KOTOR widescreen troubleshooting usually involves matching the game resolution, HUD and menu fixes, and graphics settings. Common checks are the target resolution in the game configuration, widescreen UI patches, and verifying that movies and the HUD are using assets that match the chosen aspect ratio.',
    tags: ['technical', 'widescreen', 'resolution', 'hud', 'graphics', 'pc', 'troubleshooting'],
    aliases: ['widescreen', 'resolution', 'hud', 'aspect ratio'],
  },
  {
    slug: 'save-files-windows',
    title: 'KOTOR save files on Windows',
    summary:
      'On Windows, Knights of the Old Republic save files are typically stored under the game installation directory in the saves folder, or under the user game data area depending on the distribution. Troubleshooting usually starts by checking the install path used by Steam, GOG, or the retail release and then opening the saves directory inside that install.',
    tags: ['technical', 'save', 'windows', 'paths', 'troubleshooting', 'pc'],
    aliases: ['save files', 'save folder', 'windows saves'],
  },
  {
    slug: 'reone',
    title: 'reone - Odyssey engine reimplementation',
    summary:
      'reone is an open-source reimplementation of the Odyssey engine used by KotOR. It provides engine-level code and runtime work for loading game assets, reproducing Odyssey behavior, and experimenting with modern tooling around the original game formats.',
    tags: ['tooling', 'engine', 'reone', 'odyssey', 'runtime', 'open-source'],
    aliases: ['reone'],
  },
]

const SOURCE_DESCRIPTOR = {
  id: 'trask-technical-reference',
  name: 'Trask Technical Reference',
  kind: 'website',
  description: 'Built-in technical reference notes used by the public Holocron fallback API.',
  freshnessPolicy: 'Bundled with the deployed fallback service.',
}

/** @type {Map<string, any>} */
const queryStore = new Map()
/** @type {Map<string, string[]>} */
const threadStore = new Map()
/** @type {Map<string, string[]>} */
const userHistoryStore = new Map()

function normalizeOrigin(origin) {
  return typeof origin === 'string' && origin.trim() ? origin.trim() : '*'
}

function externalOrigin(req) {
  const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto'].split(',')[0].trim()
    : ''
  const forwardedHost = typeof req.headers['x-forwarded-host'] === 'string'
    ? req.headers['x-forwarded-host'].split(',')[0].trim()
    : ''
  const host = forwardedHost || req.headers.host || `127.0.0.1:${PORT}`
  const proto = forwardedProto || (host.includes('localhost') || host.startsWith('127.0.0.1') ? 'http' : 'https')
  return `${proto}://${host}`
}

function writeJson(res, status, body, origin, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': normalizeOrigin(origin),
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Trask-Api-Key',
    Vary: 'Origin',
    ...extraHeaders,
  }
  res.writeHead(status, headers)
  res.end(JSON.stringify(body))
}

function writeText(res, status, body, origin, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Access-Control-Allow-Origin': normalizeOrigin(origin),
    'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Trask-Api-Key',
    Vary: 'Origin',
  })
  res.end(body)
}

function tokenize(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !STOPWORDS.has(token))
}

function scoreReference(query, reference) {
  const lowered = query.toLowerCase()
  for (const alias of reference.aliases) {
    if (lowered.includes(alias)) return 10_000
  }

  const queryTokens = tokenize(query)
  if (queryTokens.length === 0) return 0

  const titleTokens = tokenize(reference.title)
  const summaryTokens = tokenize(reference.summary)
  const tagTokens = reference.tags.flatMap((tag) => tokenize(tag))

  let score = 0
  for (const token of queryTokens) {
    score += titleTokens.filter((entry) => entry === token).length * 5
    score += tagTokens.filter((entry) => entry === token).length * 3
    score += summaryTokens.filter((entry) => entry === token).length
  }
  return score
}

function chooseReference(query) {
  return REFERENCES
    .map((reference) => ({ reference, score: scoreReference(query, reference) }))
    .sort((left, right) => right.score - left.score)[0] ?? null
}

function sourceUrl(origin, slug) {
  return new URL(`/reference/${slug}`, origin).toString()
}

function sourceForReference(origin, reference) {
  return {
    id: `${SOURCE_DESCRIPTOR.id}:${reference.slug}`,
    name: `${SOURCE_DESCRIPTOR.name}: ${reference.title}`,
    url: sourceUrl(origin, reference.slug),
  }
}

function buildFallbackAnswer(query, origin, match) {
  if (match && match.score > 0) {
    const source = sourceForReference(origin, match.reference)
    return {
      answer: [
        `Based on indexed KOTOR archive material, here is a concise answer about ${query}:`,
        '',
        `- ${match.reference.title}: ${match.reference.summary} [1]`,
        '',
        'Sources',
        `1. ${source.name} - ${source.url}`,
      ].join('\n'),
      sources: [source],
      retrievedSources: [source],
    }
  }

  const supported = REFERENCES.map((reference, index) => `${index + 1}. ${reference.title}`).join('\n')
  return {
    answer: [
      `I do not have enough built-in evidence to answer "${query}" confidently from this public fallback API.`,
      '',
      'The public fallback currently has bundled references for these technical topics:',
      supported,
      '',
      'Sources',
      `1. ${SOURCE_DESCRIPTOR.name} - ${new URL('/reference', origin).toString()}`,
    ].join('\n'),
    sources: [
      {
        id: SOURCE_DESCRIPTOR.id,
        name: SOURCE_DESCRIPTOR.name,
        url: new URL('/reference', origin).toString(),
      },
    ],
    retrievedSources: [],
  }
}

function rememberRecord(record) {
  queryStore.set(record.queryId, record)

  const threadIds = threadStore.get(record.threadId) ?? []
  threadIds.unshift(record.queryId)
  threadStore.set(record.threadId, [...new Set(threadIds)].slice(0, 50))

  const historyIds = userHistoryStore.get(record.userId) ?? []
  historyIds.unshift(record.queryId)
  userHistoryStore.set(record.userId, [...new Set(historyIds)].slice(0, 100))
}

function recordsForIds(ids) {
  return ids
    .map((id) => queryStore.get(id))
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk.toString('utf8')
      if (data.length > 1024 * 1024) {
        reject(new Error('request body too large'))
        req.destroy()
      }
    })
    req.on('end', () => {
      if (!data.trim()) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(data))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function referencePage(reference) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${reference.title}</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 720px; margin: 3rem auto; padding: 0 1rem; line-height: 1.6; background: #111827; color: #f9fafb; }
      h1 { color: #fca5a5; }
      code { background: rgba(255,255,255,0.08); padding: 0.1rem 0.3rem; border-radius: 4px; }
      a { color: #fca5a5; }
    </style>
  </head>
  <body>
    <h1>${reference.title}</h1>
    <p>${reference.summary}</p>
    <p><strong>Tags:</strong> ${reference.tags.join(', ')}</p>
    <p>This reference is bundled with the public Holocron fallback API.</p>
  </body>
</html>`
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin ?? '*'
  const requestUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? `127.0.0.1:${PORT}`}`)
  const publicOrigin = externalOrigin(req)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': normalizeOrigin(origin),
      'Access-Control-Allow-Methods': 'GET,HEAD,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Trask-Api-Key',
      Vary: 'Origin',
    })
    res.end()
    return
  }

  if (requestUrl.pathname === '/' && req.method === 'GET') {
    writeText(res, 200, 'OpenKotOR Trask API is running.\n', origin)
    return
  }

  if (requestUrl.pathname === '/healthz' && req.method === 'GET') {
    writeJson(res, 200, { ok: true, mode: 'fallback-public-api' }, origin)
    return
  }

  if (requestUrl.pathname === '/reference' && req.method === 'GET') {
    const body = [
      '<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Trask Technical References</title></head><body>',
      '<h1>Trask Technical References</h1>',
      '<ul>',
      ...REFERENCES.map((reference) => `<li><a href="${new URL(`/reference/${reference.slug}`, publicOrigin).toString()}">${reference.title}</a></li>`),
      '</ul>',
      '</body></html>',
    ].join('')
    writeText(res, 200, body, origin, 'text/html; charset=utf-8')
    return
  }

  if (requestUrl.pathname.startsWith('/reference/') && req.method === 'GET') {
    const slug = decodeURIComponent(requestUrl.pathname.slice('/reference/'.length))
    const reference = REFERENCES.find((entry) => entry.slug === slug)
    if (!reference) {
      writeText(res, 404, 'Not found', origin)
      return
    }
    writeText(res, 200, referencePage(reference), origin, 'text/html; charset=utf-8')
    return
  }

  if (requestUrl.pathname === '/api/trask/session' && req.method === 'GET') {
    writeJson(res, 200, { loggedIn: false, oauthAvailable: false }, origin)
    return
  }

  if (requestUrl.pathname === '/api/trask/auth/logout' && req.method === 'POST') {
    writeJson(res, 204, {}, origin)
    return
  }

  if (requestUrl.pathname === '/api/trask/models' && req.method === 'GET') {
    writeJson(
      res,
      200,
      { models: [{ id: 'auto', label: 'Auto', provider: 'Public fallback', recommended: true }] },
      origin,
    )
    return
  }

  if (requestUrl.pathname === '/api/trask/sources' && req.method === 'GET') {
    const sources = REFERENCES.map((reference) => ({
      ...SOURCE_DESCRIPTOR,
      id: `${SOURCE_DESCRIPTOR.id}:${reference.slug}`,
      name: `${SOURCE_DESCRIPTOR.name}: ${reference.title}`,
      homeUrl: sourceUrl(publicOrigin, reference.slug),
    }))
    writeJson(res, 200, { sources }, origin)
    return
  }

  if (requestUrl.pathname.startsWith('/api/trask/thread/') && req.method === 'GET') {
    const threadId = decodeURIComponent(requestUrl.pathname.slice('/api/trask/thread/'.length))
    if (!isUuid(threadId)) {
      writeJson(res, 400, { error: 'Invalid thread id.' }, origin)
      return
    }
    const ids = threadStore.get(threadId) ?? []
    writeJson(res, 200, { history: recordsForIds(ids) }, origin)
    return
  }

  if (requestUrl.pathname === '/api/trask/history' && req.method === 'GET') {
    const threadId = requestUrl.searchParams.get('thread')
    const limit = Math.max(1, Math.min(100, Number.parseInt(requestUrl.searchParams.get('limit') ?? '20', 10) || 20))
    const ids = threadId ? (threadStore.get(threadId) ?? []) : (userHistoryStore.get('qa-webui') ?? [])
    writeJson(res, 200, { history: recordsForIds(ids).slice(0, limit) }, origin)
    return
  }

  if (requestUrl.pathname.startsWith('/api/trask/query/') && requestUrl.pathname.endsWith('/cancel') && req.method === 'POST') {
    const queryId = decodeURIComponent(requestUrl.pathname.slice('/api/trask/query/'.length, -'/cancel'.length))
    const record = queryStore.get(queryId)
    if (!record) {
      writeJson(res, 404, { error: 'Query not found.' }, origin)
      return
    }
    writeJson(res, 200, { query: record }, origin)
    return
  }

  if (requestUrl.pathname === '/api/trask/ask' && req.method === 'POST') {
    try {
      const body = await parseBody(req)
      const query = typeof body.query === 'string' ? body.query.trim() : ''
      if (!query) {
        writeJson(res, 400, { error: 'Query is required.' }, origin)
        return
      }

      const providedThreadId = typeof body.threadId === 'string' ? body.threadId.trim() : ''
      if (providedThreadId && !isUuid(providedThreadId)) {
        writeJson(res, 422, { error: 'threadId must be a valid UUID.' }, origin)
        return
      }

      const threadId = providedThreadId || randomUUID()
      const queryId = randomUUID()
      const now = new Date().toISOString()
      const match = chooseReference(query)
      const { answer, sources, retrievedSources } = buildFallbackAnswer(query, publicOrigin, match)
      const record = {
        queryId,
        threadId,
        userId: 'qa-webui',
        query,
        status: 'complete',
        answer,
        sources,
        retrievedSources,
        visitedUrls: [],
        error: null,
        createdAt: now,
        completedAt: now,
        liveTrace: [
          { at: now, phase: 'queued', detail: 'Fallback public Trask query accepted.' },
          { at: now, phase: 'compose', detail: 'Rendered bundled technical reference answer.' },
        ],
      }
      rememberRecord(record)
      writeJson(res, 201, { query: record }, origin)
      return
    } catch (error) {
      writeJson(res, 500, { error: error instanceof Error ? error.message : 'Unknown error.' }, origin)
      return
    }
  }

  writeJson(res, 404, { error: 'Not found' }, origin)
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`hf-trask-api listening on ${PORT}`)
})
