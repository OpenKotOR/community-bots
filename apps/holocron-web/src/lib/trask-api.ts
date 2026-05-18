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

function apiBase(): string {
  return import.meta.env.VITE_TRASK_API_BASE?.replace(/\/+$/, '') ?? ''
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

/** User-facing message for failed Trask HTTP calls (handles DOMException / TypeError). */
export function traskErrorMessageFromUnknown(error: unknown): string {
  const abortish = (name: string | undefined) => name === 'AbortError' || name === 'TimeoutError'
  if (error instanceof Error && abortish(error.name)) {
    return 'Trask request timed out. Run trask-http-server on port 4010, or set VITE_TRASK_API_BASE to a reachable host.'
  }
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const name = String((error as { name: unknown }).name)
    if (abortish(name)) {
      return 'Trask request timed out. Run trask-http-server on port 4010, or set VITE_TRASK_API_BASE to a reachable host.'
    }
  }
  if (error instanceof Error && typeof error.message === 'string' && error.message) {
    return error.message
  }
  return 'Trask request failed.'
}

function traskRequestInit(apiKey?: string, init?: RequestInit, timeoutMs?: number): RequestInit {
  const sameOrigin = !apiBase()
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
  return !apiBase()
}

export async function traskFetchSession(): Promise<TraskSessionDto | null> {
  try {
    const res = await fetch(`${apiBase()}/api/trask/session`, traskRequestInit())
    if (!res.ok) {
      return null
    }
    return (await res.json()) as TraskSessionDto
  } catch {
    return null
  }
}

export async function traskLogout(): Promise<void> {
  await fetch(`${apiBase()}/api/trask/auth/logout`, traskRequestInit(undefined, { method: 'POST' }))
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
  const res = await fetch(
    `${apiBase()}/api/trask/thread/${encodeURIComponent(threadId)}`,
    traskRequestInit(apiKey, init),
  )
  const data = (await res.json()) as { history?: TraskHistoryRecordDto[]; error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? `thread failed: ${res.status}`)
  }
  return data.history ?? []
}

export async function traskListSources(apiKey?: string): Promise<TraskSourceDto[]> {
  const res = await fetch(`${apiBase()}/api/trask/sources`, traskRequestInit(apiKey))
  const data = (await res.json()) as { sources?: TraskSourceDto[]; error?: string }
  if (!res.ok) {
    throw new Error(data.error ?? `sources failed: ${res.status}`)
  }
  return data.sources ?? []
}

export async function traskListModels(apiKey?: string): Promise<TraskModelOptionDto[]> {
  const res = await fetch(`${apiBase()}/api/trask/models`, traskRequestInit(apiKey))
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
  const res = await fetch(`${apiBase()}/api/trask/history?${q}`, traskRequestInit(apiKey))
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
  const res = await fetch(`${apiBase()}/api/trask/ask`, traskRequestInit(apiKey, {
    method: 'POST',
    body: JSON.stringify(body),
  }, traskAskTimeoutMs()))
  const data = (await res.json()) as {
    error?: string
    query?: TraskHistoryRecordDto
  }
  const record = data.query
  if (!record) {
    throw new Error(data.error ?? `ask failed: ${res.status}`)
  }
  if (!res.ok && res.status !== 202) {
    throw new Error(data.error ?? record.error ?? `ask failed: ${res.status}`)
  }
  if (record.status === 'failed') {
    throw new Error(record.error ?? 'Trask research failed.')
  }
  return record
}

export async function traskCancelQuery(queryId: string, apiKey?: string): Promise<TraskHistoryRecordDto | null> {
  const res = await fetch(
    `${apiBase()}/api/trask/query/${encodeURIComponent(queryId)}/cancel`,
    traskRequestInit(apiKey, { method: 'POST' }),
  )
  const data = (await res.json()) as { query?: TraskHistoryRecordDto; error?: string }
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(data.error ?? `cancel failed: ${res.status}`)
  }
  return data.query ?? null
}
