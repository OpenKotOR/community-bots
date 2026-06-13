/**
 * Calls a host that mounts `createTraskHttpRouter` at `/api/trask`
 * (standalone `@openkotor/trask-http-server` or Trask bot embedded Holocron).
 */

import type { SourceWeight } from './types'

export interface TraskSourceDto {
  id: string
  name: string
  kind: string
  homeUrl: string
  description: string
  freshnessPolicy: string
}

export interface TraskHistoryLiveEventDto {
  at: string
  phase: string
  detail?: string
  sources?: Array<{ id: string; name: string; url: string }>
  diag?: Record<string, string | number | boolean>
  urls?: string[]
}

export interface TraskHistoryRecordDto {
  queryId: string
  threadId?: string
  userId: string
  query: string
  status: 'pending' | 'complete' | 'failed'
  answer: string | null
  sources: Array<{ id: string; name: string; url: string }>
  retrievedSources?: Array<{ id: string; name: string; url: string }>
  visitedUrls?: string[]
  error: string | null
  createdAt: string
  completedAt: string | null
  /** Progress timeline while pending (and retained after completion for replay/debug). */
  liveTrace?: TraskHistoryLiveEventDto[]
  groundingStatus?: 'grounded' | 'partial' | 'failed'
}

export interface TraskSessionDto {
  loggedIn: boolean
  oauthAvailable?: boolean
  discord?: { id: string; username: string; displayName: string }
}

export interface TraskModelOptionDto {
  id: string
  label: string
  provider: string
  recommended?: boolean
}

const DEFAULT_TRASK_PUBLIC_WORKER_BASE = 'https://trask-worker.bocloud.workers.dev'
const DEFAULT_TRASK_PUBLIC_FALLBACK_BASE = 'https://openkotor-holocron-trask-http.hf.space'

function trimBase(value: string | undefined | null): string {
  return value?.replace(/\/+$/, '').trim() ?? ''
}

function parseConfiguredBases(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => trimBase(entry))
    .filter(Boolean)
}

function dedupeBases(values: string[]): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const base of values) {
    const key = base.trim()
    if (!key || seen.has(key)) continue
    seen.add(key)
    ordered.push(key)
  }
  return ordered
}

function isLocalhostBase(base: string): boolean {
  try {
    const url = new URL(base)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function resolveTraskApiBases(): string[] {
  const explicitBases = parseConfiguredBases(import.meta.env.VITE_TRASK_API_BASES)
  if (explicitBases.length > 0) {
    return dedupeBases(explicitBases)
  }

  const primary = trimBase(import.meta.env.VITE_TRASK_API_BASE)
  const fallback = trimBase(import.meta.env.VITE_TRASK_API_FALLBACK_BASE) || DEFAULT_TRASK_PUBLIC_FALLBACK_BASE
  const resolved: string[] = []

  if (primary) {
    resolved.push(primary)
  } else if (typeof window !== 'undefined' && isLocalhostBase(window.location.origin)) {
    if (window.location.port === '4010') {
      return ['']
    }
    resolved.push(`${window.location.protocol}//127.0.0.1:4010`)
  } else {
    resolved.push(DEFAULT_TRASK_PUBLIC_WORKER_BASE)
  }

  if (fallback && !resolved.includes(fallback)) {
    resolved.push(fallback)
  }

  if (typeof window !== 'undefined' && isLocalhostBase(window.location.origin) && window.location.port !== '4010') {
    resolved.push('')
  }

  return dedupeBases(resolved)
}

export function traskApiOrigin(): string {
  return resolveTraskApiBases()[0] ?? ''
}

export interface TraskHealthDto {
  ok: boolean
  mode?: string
  upstream?: string
  upstreamReachable?: boolean
  upstreamStatus?: number
  upstreamDetail?: string
  builtinFallback?: boolean
  resolvedApiBase?: string
  attemptedApiBases?: string[]
  fallbackUsed?: boolean
}

function authHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  const key =
    apiKey?.trim() ||
    (typeof import.meta.env.VITE_TRASK_API_KEY === 'string' ? import.meta.env.VITE_TRASK_API_KEY.trim() : '')
  if (key) {
    headers.Authorization = `Bearer ${key}`
  }
  return headers
}

/** Wall-clock cap for routine Trask HTTP calls (session, sources, poll iteration). */
const DEFAULT_TRASK_FETCH_TIMEOUT_MS = 20_000

/** POST /ask may block until research completes when the server uses synchronous mode. */
const DEFAULT_TRASK_ASK_TIMEOUT_MS = 120_000

export function traskFetchTimeoutMs(): number {
  const raw = import.meta.env.VITE_TRASK_FETCH_TIMEOUT_MS
  const n = typeof raw === 'string' ? Number(raw.trim()) : NaN
  return Number.isFinite(n) && n >= 3_000 ? n : DEFAULT_TRASK_FETCH_TIMEOUT_MS
}

export function traskAskTimeoutMs(): number {
  const askRaw =
    import.meta.env.VITE_TRASK_ASK_TIMEOUT_MS ?? import.meta.env.VITE_TRASK_RESEARCH_TIMEOUT_MS
  const askN = typeof askRaw === 'string' ? Number(askRaw.trim()) : NaN
  if (Number.isFinite(askN) && askN >= 3_000) {
    return askN
  }
  return Math.max(traskFetchTimeoutMs(), DEFAULT_TRASK_ASK_TIMEOUT_MS)
}

function abortAfterTimeout(ms: number): AbortSignal {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(ms)
  }
  const c = new AbortController()
  globalThis.setTimeout(() => c.abort(), ms)
  return c.signal
}

function mergeAbortSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any
  if (typeof anyFn === 'function') {
    return anyFn([a, b])
  }
  const c = new AbortController()
  const forward = () => c.abort()
  a.addEventListener('abort', forward)
  b.addEventListener('abort', forward)
  return c.signal
}

type TraskApiErrorPayload = {
  error?: string
  hint?: string
  upstream?: string
  upstreamStatus?: number
  upstreamDetail?: string
}

function formatTraskApiError(data: TraskApiErrorPayload | null | undefined, status: number): string {
  const parts: string[] = []
  if (data?.error) parts.push(data.error)
  if (data?.upstreamStatus !== undefined) {
    parts.push(`upstream HTTP ${data.upstreamStatus}`)
  }
  if (data?.upstream) parts.push(`upstream ${data.upstream}`)
  if (data?.hint) parts.push(data.hint)
  if (data?.upstreamDetail) {
    const snippet = data.upstreamDetail.replace(/\s+/g, ' ').trim().slice(0, 160)
    if (snippet) parts.push(snippet)
  }
  if (parts.length > 0) return parts.join(' — ')
  return `Holocron API request failed (HTTP ${status}).`
}

async function readTraskErrorBody(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as TraskApiErrorPayload
    return formatTraskApiError(data, res.status)
  } catch {
    return `Holocron API request failed (HTTP ${res.status}).`
  }
}

/** User-facing message for failed Trask HTTP calls (handles DOMException / TypeError). */
export function traskErrorMessageFromUnknown(error: unknown): string {
  const abortish = (name: string | undefined) => name === 'AbortError' || name === 'TimeoutError'
  if (error instanceof Error && abortish(error.name)) {
    return 'Holocron request timed out. Run the research server on port 4010 (`pnpm dev:trask-http`), or set VITE_TRASK_API_BASE to a reachable host.'
  }
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = String((error as { name: unknown }).name)
    if (abortish(name)) {
      return 'Holocron request timed out. Run the research server on port 4010 (`pnpm dev:trask-http`), or set VITE_TRASK_API_BASE to a reachable host.'
    }
  }
  if (error instanceof Error && typeof error.message === 'string' && error.message) {
    return error.message
  }
  return 'Holocron request failed.'
}

function traskRequestInit(apiKey?: string, init?: RequestInit, timeoutMs?: number, sameOrigin = false): RequestInit {
  const baseHeaders = authHeaders(apiKey)
  const extra =
    init?.headers && typeof init.headers === 'object' && !Array.isArray(init.headers)
      ? (init.headers as Record<string, string>)
      : {}
  const ms = timeoutMs ?? traskFetchTimeoutMs()
  const timeoutSignal = abortAfterTimeout(ms)
  const userSignal = init?.signal ?? undefined
  const signal = userSignal ? mergeAbortSignals(userSignal, timeoutSignal) : timeoutSignal
  return {
    ...init,
    credentials: sameOrigin ? 'include' : 'omit',
    headers: { ...baseHeaders, ...extra },
    signal,
  }
}

export function traskUsesSameOriginApi(): boolean {
  return traskApiOrigin() === ''
}

type TraskFailoverResponse = {
  response: Response
  resolvedBase: string
  attemptedBases: string[]
  fallbackUsed: boolean
}

async function fetchTraskWithFailover(path: string, init?: RequestInit, timeoutMs?: number): Promise<TraskFailoverResponse> {
  const bases = resolveTraskApiBases()
  const attemptTimeoutMs = Math.min(timeoutMs ?? traskFetchTimeoutMs(), 12_000)
  let lastResponse: Response | null = null
  let lastError: Error | null = null
  const attemptedBases: string[] = []

  for (let i = 0; i < bases.length; i += 1) {
    const base = bases[i] ?? ''
    attemptedBases.push(base)
    const sameOrigin = base === ''
    const url = base ? `${base}${path.startsWith('/') ? path : `/${path}`}` : path
    const requestInit = traskRequestInit(undefined, init, attemptTimeoutMs, sameOrigin)
    try {
      const response = await fetch(url, requestInit)
      if (response.status >= 500 && response.status <= 599) {
        lastResponse = response
        continue
      }
      return { response, resolvedBase: base, attemptedBases, fallbackUsed: i > 0 }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
    }
  }

  if (lastResponse) {
    return {
      response: lastResponse,
      resolvedBase: attemptedBases[attemptedBases.length - 1] ?? '',
      attemptedBases,
      fallbackUsed: attemptedBases.length > 1,
    }
  }

  if (lastError) {
    throw lastError
  }

  throw new Error(`Failed to reach API for ${path}`)
}

export async function traskFetchHealth(): Promise<TraskHealthDto> {
  const { response, resolvedBase, attemptedBases, fallbackUsed } = await fetchTraskWithFailover(
    '/healthz',
    { method: 'GET' },
    12_000,
  )
  const data = (await response.json().catch(() => ({}))) as TraskHealthDto & { error?: string }
  if (!response.ok) {
    throw new Error(data.error ?? (await readTraskErrorBody(response)))
  }
  return {
    ...data,
    resolvedApiBase: resolvedBase,
    attemptedApiBases: attemptedBases,
    fallbackUsed,
  }
}

export async function traskFetchSession(): Promise<TraskSessionDto | null> {
  try {
    const { response } = await fetchTraskWithFailover('/api/trask/session', { method: 'GET' }, traskFetchTimeoutMs())
    const res = response
    if (!res.ok) {
      return null
    }
    return (await res.json()) as TraskSessionDto
  } catch {
    return null
  }
}

export async function traskLogout(): Promise<void> {
  const { response } = await fetchTraskWithFailover(
    '/api/trask/auth/logout',
    { method: 'POST' },
    traskFetchTimeoutMs(),
  )
  if (!response.ok) {
    throw new Error(await readTraskErrorBody(response))
  }
}

/** Tighter per-iteration budget while polling `/thread` so one dead hop cannot waste the full Trask HTTP timeout. */
const POLL_ITERATION_MS = 12_000

export function traskPollIterationSignal(): AbortSignal {
  return abortAfterTimeout(POLL_ITERATION_MS)
}

/** Thread history for the authenticated session (same auth as `/history` / `/ask`). */
export async function traskGetThread(
  threadId: string,
  apiKey?: string,
  outerSignal?: AbortSignal,
): Promise<TraskHistoryRecordDto[]> {
  const init: RequestInit = outerSignal
    ? { method: 'GET', signal: outerSignal }
    : { method: 'GET' }
  const { response: res } = await fetchTraskWithFailover(
    `/api/trask/thread/${encodeURIComponent(threadId)}`,
    { ...init, headers: authHeaders(apiKey) },
    traskFetchTimeoutMs(),
  )
  const data = (await res.json()) as { history?: TraskHistoryRecordDto[]; error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? (await readTraskErrorBody(res)))
  }
  return data.history ?? []
}

export async function traskListSources(apiKey?: string): Promise<TraskSourceDto[]> {
  const { response: res } = await fetchTraskWithFailover(
    '/api/trask/sources',
    { method: 'GET', headers: authHeaders(apiKey) },
    traskFetchTimeoutMs(),
  )
  const data = (await res.json()) as { sources?: TraskSourceDto[]; error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? `sources failed: ${res.status}`)
  }
  return data.sources ?? []
}

export async function traskListModels(apiKey?: string): Promise<TraskModelOptionDto[]> {
  const { response: res } = await fetchTraskWithFailover(
    '/api/trask/models',
    { method: 'GET', headers: authHeaders(apiKey) },
    traskFetchTimeoutMs(),
  )
  const data = (await res.json()) as { models?: TraskModelOptionDto[]; error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? `models failed: ${res.status}`)
  }
  return data.models ?? []
}

export async function traskListHistory(
  limit: number,
  apiKey?: string,
  threadId?: string,
): Promise<TraskHistoryRecordDto[]> {
  const q = new URLSearchParams({ limit: String(limit) })
  if (threadId?.trim()) {
    q.set('thread', threadId.trim())
  }
  const { response: res } = await fetchTraskWithFailover(
    `/api/trask/history?${q}`,
    { method: 'GET', headers: authHeaders(apiKey) },
    traskFetchTimeoutMs(),
  )
  const data = (await res.json()) as { history?: TraskHistoryRecordDto[]; error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? `history failed: ${res.status}`)
  }
  return data.history ?? []
}

/**
 * Starts a Trask retrieval. When the server persists queries (logged-in / API-key sessions),
 * responds with **202** and `pending`; poll `traskGetThread(threadId, apiKey)` until `complete` | `failed`.
 * Anonymous non-persist mode returns **201** with a finished record in one shot.
 */
export async function traskAsk(
  query: string,
  apiKey?: string,
  threadId?: string,
  model?: string,
  sourceWeights?: SourceWeight[],
): Promise<TraskHistoryRecordDto> {
  const body: { query: string; threadId?: string; model?: string; sourceWeights?: SourceWeight[] } = { query }
  if (threadId?.trim()) {
    body.threadId = threadId.trim()
  }
  if (model?.trim()) {
    body.model = model.trim()
  }
  if (sourceWeights?.length) {
    body.sourceWeights = sourceWeights
  }
  const { response: res } = await fetchTraskWithFailover(
    '/api/trask/ask',
    {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
    },
    traskAskTimeoutMs(),
  )
  const data = (await res.json()) as TraskApiErrorPayload & {
    query?: TraskHistoryRecordDto
  }
  const record = data.query
  if (!res.ok && res.status !== 202) {
    throw new Error(data.error ?? record?.error ?? formatTraskApiError(data, res.status))
  }
  if (!record) {
    throw new Error(data.error ?? formatTraskApiError(data, res.status))
  }
  if (record.status === 'failed') {
    throw new Error(record.error ?? 'Holocron research failed.')
  }
  return record
}

export async function traskCancelQuery(queryId: string, apiKey?: string): Promise<TraskHistoryRecordDto | null> {
  const { response: res } = await fetchTraskWithFailover(
    `/api/trask/query/${encodeURIComponent(queryId)}/cancel`,
    {
      method: 'POST',
      headers: authHeaders(apiKey),
    },
    traskFetchTimeoutMs(),
  )
  const data = (await res.json()) as { query?: TraskHistoryRecordDto; error?: string }
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(data.error ?? `cancel failed: ${res.status}`)
  }
  return data.query ?? null
}
