import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Message as MessageType, AgentResult, SourceWeight, DEFAULT_SOURCE_WEIGHTS, Conversation, QueryType, MessageResearchStep, isMessageArray, mergeSourceWeights } from '@/lib/types'
import { Message } from '@/components/Message'
import { AgentPanel } from '@/components/AgentPanel'
import { ConversationSidebar } from '@/components/ConversationSidebar'
import { HolocronModelPicker } from '@/components/HolocronModelPicker'
import { SourceWeightsDialog } from '@/components/SourceWeightsDialog'
import { KeyboardShortcutsDialog } from '@/components/KeyboardShortcutsDialog'
import { PromptsDialog } from '@/components/PromptsDialog'
import { TopNav, type HolocronSessionUi } from '@/components/TopNav'
import { HolocronGlyph } from '@/components/HolocronGlyph'
import {
  HolocronSanctum,
  type HolocronFluxEvent,
  type HolocronRetrievalPulse,
  type HolocronSourceZone,
  shardZoneForToken,
  zoneFromQueryKeyTerms,
  zoneFromSourceLabel,
} from '@/components/HolocronSanctum'
import { fluxTokensFromQuery, holocronQuerySignature } from '@/lib/holocron-live'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { ArrowRight, Sliders, Keyboard, Code, ArrowDown, List } from '@phosphor-icons/react'
import { toast } from 'sonner'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { usePrompts } from '@/lib/prompts'
import {
  detectQuestionRelevance,
  performMultiAgentRetrieval,
  aggregateAnswer,
  classifyQueryType,
} from '@/lib/qa-engine'
import { conversationDisplayTitle } from '@/lib/conversation-utils'
import { usePersistentLocalState } from '@/lib/persistent-local-state'
import {
  TRASK_MODEL_AUTO,
  TRASK_MODEL_OPTIONS,
  mergeTraskModelOptions,
  modelPayloadValue,
  normalizeTraskModelSelection,
  traskModelLabel,
  type TraskModelOption,
} from '@/lib/trask-models'
import {
  traskAsk,
  traskCancelQuery,
  traskFetchSession,
  traskGetThread,
  traskListHistory,
  traskListModels,
  traskLogout,
  traskPollIterationSignal,
  traskUsesSameOriginApi,
  type TraskHistoryLiveEventDto,
  type TraskHistoryRecordDto,
  type TraskSessionDto,
} from '@/lib/trask-api'
import { priorUserQuestionsFromOtherThreads } from '@/lib/starter-suggestions'

const legacySparkMode = import.meta.env.VITE_TRASK_LEGACY_SPARK === '1'
const CONVERSATIONS_KEY = 'qa-conversations-v2'
const LEGACY_CONVERSATIONS_KEY = 'qa-conversations'
const HOLOCRON_RESEARCH_JOBS_KEY = 'holocron-research-jobs'
const RESEARCH_RETRY_BASE_MS = 5_000
const RESEARCH_RETRY_MAX_MS = 90_000
/** ~2.5 min of missing thread rows before re-dispatching (research can run up to ~90s). */
const RESEARCH_POLL_FAILURE_GIVE_UP = 48
const SIDEBAR_WIDTH_MIN = 260
const SIDEBAR_WIDTH_MAX = 520

function clampSidebarWidth(value: number): number {
  return Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, Math.round(value)))
}

type HolocronResearchJobState = 'queued' | 'submitted'

type HolocronResearchJob = {
  clientId: string
  conversationId: string
  threadId: string
  question: string
  assistantMessageId: string
  queryType: QueryType
  serverQueryId?: string
  modelId?: string
  sourceWeights?: SourceWeight[]
  state: HolocronResearchJobState
  attemptCount: number
  pollFailures: number
  createdAt: number
  updatedAt: number
  nextAttemptAt: number
}

function isHolocronResearchJob(value: unknown): value is HolocronResearchJob {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const o = value as Record<string, unknown>
  return (
    typeof o.clientId === 'string'
    && typeof o.conversationId === 'string'
    && typeof o.threadId === 'string'
    && typeof o.question === 'string'
    && typeof o.assistantMessageId === 'string'
    && (o.modelId === undefined || typeof o.modelId === 'string')
    && (o.sourceWeights === undefined || Array.isArray(o.sourceWeights))
    && (o.state === 'queued' || o.state === 'submitted')
    && typeof o.attemptCount === 'number'
    && typeof o.pollFailures === 'number'
    && typeof o.createdAt === 'number'
    && typeof o.updatedAt === 'number'
    && typeof o.nextAttemptAt === 'number'
  )
}

function normalizeResearchJobs(value: unknown): HolocronResearchJob[] {
  return Array.isArray(value) ? value.filter(isHolocronResearchJob) : []
}

function researchRetryDelayMs(attemptCount: number): number {
  const exp = Math.min(6, Math.max(0, attemptCount))
  const jitter = Math.floor(Math.random() * 1_500)
  return Math.min(RESEARCH_RETRY_MAX_MS, RESEARCH_RETRY_BASE_MS * 2 ** exp) + jitter
}

function createHolocronThreadId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    const hex = () => Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')
    return `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex().slice(1)}-${hex()}${hex()}${hex()}`
  }
}

function traskRetrievingAgent(question: string): AgentResult {
  return {
    agentName: 'Trask',
    source: 'holocron',
    snippet: shortFluxWords(question, 10),
    confidence: 0,
    status: 'retrieving',
  }
}

function createResearchLoadingMessage(
  id: string,
  question: string,
  timestamp: number,
  queryType: QueryType = 'general',
  steps: MessageResearchStep[] = [],
): MessageType {
  return {
    id,
    role: 'assistant',
    content: 'Consulting the archives. The answer will appear here when the research completes.',
    timestamp,
    isExpanded: false,
    agentResults: [traskRetrievingAgent(question)],
    queryType,
    researchStatus: 'pending',
    researchSteps: steps,
  }
}

function isResearchLoadingMessage(message: MessageType): boolean {
  return message.role === 'assistant'
    && Boolean(message.agentResults?.some((agent) => agent.source === 'holocron' && agent.status === 'retrieving'))
}

function humanPhaseLabel(phaseRaw: string): string {
  const phase = phaseRaw.trim().toLowerCase()
  switch (phase) {
    case 'gather':
      return 'Gathering'
    case 'report':
      return 'Analyzing'
    case 'sources':
      return 'Verifying sources'
    case 'compose':
      return 'Composing answer'
    default:
      return phase ? phase[0]!.toUpperCase() + phase.slice(1) : 'Processing'
  }
}

function mapResearchStepsFromRecord(rec: TraskHistoryRecordDto): MessageResearchStep[] {
  const trace = rec.liveTrace ?? []
  return trace.map((ev, index) => {
    const at = Date.parse(ev.at) || Date.parse(rec.createdAt) || Date.now()
    const detail = (ev.detail ?? '').trim() || `${humanPhaseLabel(ev.phase)} in progress`
    return {
      id: `${rec.queryId}:${index}:${ev.phase}:${ev.at}`,
      at,
      phase: ev.phase,
      detail,
      sources: ev.sources,
    }
  })
}

function localResearchStep(phase: string, detail: string): MessageResearchStep {
  return {
    id: `local:${phase}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    phase,
    detail,
  }
}

function normalizeTraskAnswerText(answer: string | null | undefined): string {
  return answer?.replace(/\r\n/g, '\n').trim() ?? ''
}

function isTraskSynthesisFailureText(answer: string): boolean {
  return /could not complete live archive synthesis/i.test(answer)
}

function mapSourcesFromTraskRecord(rec: TraskHistoryRecordDto) {
  const answer = normalizeTraskAnswerText(rec.answer)
  if (rec.status !== 'complete' || isTraskSynthesisFailureText(answer)) return []

  return (rec.sources ?? []).map((s) => ({
    name: s.name,
    url: s.url,
    confidence: 1,
  }))
}

function createAssistantMessageFromTraskRecord(rec: TraskHistoryRecordDto, queryType: QueryType): MessageType | null {
  const answer = normalizeTraskAnswerText(rec.answer)
  if (rec.status !== 'complete' || !answer) return null
  const researchSteps = mapResearchStepsFromRecord(rec)
  const mappedSources = mapSourcesFromTraskRecord(rec)
  const failedSynthesis = isTraskSynthesisFailureText(answer)
  return {
    id: `srv-${rec.queryId}-a`,
    role: 'assistant',
    content: answer,
    sources: mappedSources,
    timestamp: Date.parse(rec.completedAt ?? rec.createdAt) || Date.now(),
    isExpanded: false,
    agentResults: [
      {
        agentName: 'Trask',
        source: 'holocron',
        snippet: answer.slice(0, 280),
        confidence: 1,
        status: failedSynthesis ? 'failed' : 'complete',
        retrievedContent: answer,
      },
    ],
    queryType,
    researchStatus: failedSynthesis ? 'failed' : 'complete',
    researchSteps,
  }
}

function createDegradedMessageFromTraskRecord(rec: TraskHistoryRecordDto, queryType: QueryType): MessageType {
  const content = 'Trask completed without visible answer text.'
  return {
    id: `srv-${rec.queryId}-degraded`,
    role: 'assistant',
    content,
    sources: [],
    timestamp: Date.parse(rec.completedAt ?? rec.createdAt) || Date.now(),
    isExpanded: false,
    agentResults: [
      {
        agentName: 'Trask',
        source: 'holocron',
        snippet: content,
        confidence: 0,
        status: 'failed',
      },
    ],
    queryType,
    researchStatus: 'failed',
    researchSteps: mapResearchStepsFromRecord(rec),
  }
}

function isCanceledTraskRecord(rec: TraskHistoryRecordDto): boolean {
  return rec.status === 'failed' && /canceled|cancelled/i.test(rec.error ?? '')
}

function createFailedMessageFromTraskRecord(rec: TraskHistoryRecordDto, queryType: QueryType): MessageType {
  const error = rec.error?.trim() || 'Research failed.'
  return {
    id: `srv-${rec.queryId}-failed`,
    role: 'assistant',
    content: `Research failed: ${error}`,
    timestamp: Date.parse(rec.completedAt ?? rec.createdAt) || Date.now(),
    isExpanded: false,
    agentResults: [
      {
        agentName: 'Trask',
        source: 'holocron',
        snippet: error,
        confidence: 0,
        status: 'failed',
      },
    ],
    queryType,
    researchStatus: 'failed',
    researchSteps: mapResearchStepsFromRecord(rec),
  }
}

const HOL_THREAD_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

function isHolocronThreadId(value: string): boolean {
  return HOL_THREAD_RE.test(value.trim())
}

function holocronConversationId(threadId: string): string {
  return `holocron-${threadId}`
}

function traceDedupeStorageKey(threadId: string): string {
  return `holocron-trace-seen-${threadId}`
}

function loadSeenTraceKeys(threadId: string): Set<string> {
  try {
    const raw = sessionStorage.getItem(traceDedupeStorageKey(threadId))
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((x): x is string => typeof x === 'string'))
  } catch {
    return new Set()
  }
}

function saveSeenTraceKeys(threadId: string, seen: Set<string>): void {
  try {
    const arr = [...seen]
    const tail = arr.slice(-600)
    sessionStorage.setItem(traceDedupeStorageKey(threadId), JSON.stringify(tail))
  } catch {
    /* ignore */
  }
}

function pulseWordsFromTrace(ev: TraskHistoryLiveEventDto, rec: TraskHistoryRecordDto): string {
  const raw = (ev.detail ?? ev.phase ?? '').trim()
  if (raw) return shortFluxWords(raw, 4)
  return shortFluxWords(rec.query, 2)
}

function mergeHolocronThreadMessages(local: MessageType[], records: TraskHistoryRecordDto[]): MessageType[] {
  if (records.length === 0) {
    return local
  }
  const serverMsgs = mapTraskHistoryToMessages(records)
  const serverQuestions = new Set(records.map((rec) => rec.query.trim().toLowerCase()))
  const serverMessageIds = new Set(serverMsgs.map((msg) => msg.id))

  const supplemental: MessageType[] = []
  for (let index = 0; index < local.length; index += 1) {
    const msg = local[index]!
    if (msg.role !== 'user') continue
    const question = msg.content.trim().toLowerCase()
    if (!question || serverQuestions.has(question)) continue
    if (serverMessageIds.has(msg.id)) continue
    supplemental.push(msg)
    const next = local[index + 1]
    if (
      next
      && next.role === 'assistant'
      && (isResearchLoadingMessage(next) || next.id.startsWith('pending-'))
      && !serverMessageIds.has(next.id)
    ) {
      supplemental.push(next)
    }
  }

  return ensureUniqueMessageIds(
    [...serverMsgs, ...supplemental].sort((a, b) => a.timestamp - b.timestamp),
  )
}

function conversationUpdatedAtFromMessages(messages: MessageType[], fallback: number): number {
  const timestamps = messages
    .map((message) => message.timestamp)
    .filter((timestamp) => Number.isFinite(timestamp))
  return timestamps.length ? Math.max(...timestamps) : fallback
}

function messageSignature(message: MessageType): string {
  return `${message.id}\u0000${message.role}\u0000${message.timestamp}\u0000${message.content}`
}

function ensureUniqueMessageIds(messages: MessageType[]): MessageType[] {
  const seenIds = new Set<string>()
  const seenExactMessages = new Set<string>()
  const nextMessages: MessageType[] = []
  for (const message of messages) {
    const exact = messageSignature(message)
    if (seenExactMessages.has(exact)) continue
    seenExactMessages.add(exact)

    if (!seenIds.has(message.id)) {
      seenIds.add(message.id)
      nextMessages.push(message)
      continue
    }

    let suffix = 2
    let nextId = `${message.id}-dup-${suffix}`
    while (seenIds.has(nextId)) {
      suffix += 1
      nextId = `${message.id}-dup-${suffix}`
    }
    seenIds.add(nextId)
    nextMessages.push({ ...message, id: nextId })
  }
  return nextMessages
}

function normalizeConversationForStorage(conversation: Conversation): Conversation {
  const messages = ensureUniqueMessageIds(isMessageArray(conversation.messages) ? conversation.messages : [])
  const createdAt = Number.isFinite(conversation.createdAt) ? conversation.createdAt : Date.now()
  return {
    ...conversation,
    messages,
    createdAt,
    updatedAt: conversationUpdatedAtFromMessages(messages, Number.isFinite(conversation.updatedAt) ? conversation.updatedAt : createdAt),
  }
}

function loadInitialConversations(): Conversation[] {
  if (typeof window === 'undefined') return []
  for (const key of [CONVERSATIONS_KEY, LEGACY_CONVERSATIONS_KEY]) {
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) continue
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) continue
      return parsed
        .filter((conversation): conversation is Conversation => {
          if (!conversation || typeof conversation !== 'object') return false
          const candidate = conversation as Partial<Conversation>
          return typeof candidate.id === 'string' && typeof candidate.title === 'string'
        })
        .map(normalizeConversationForStorage)
    } catch {
      /* try the next key */
    }
  }
  return []
}

function recordRankForSync(record: TraskHistoryRecordDto): number {
  switch (record.status) {
    case 'complete':
      return 3
    case 'failed':
      return 2
    case 'pending':
    default:
      return 1
  }
}

function recordSyncTimestamp(record: TraskHistoryRecordDto): number {
  const completed = Date.parse(record.completedAt ?? '')
  if (Number.isFinite(completed)) return completed
  const created = Date.parse(record.createdAt)
  return Number.isFinite(created) ? created : 0
}

function pickPreferredRecord(current: TraskHistoryRecordDto, next: TraskHistoryRecordDto): TraskHistoryRecordDto {
  const currentRank = recordRankForSync(current)
  const nextRank = recordRankForSync(next)
  if (nextRank !== currentRank) {
    return nextRank > currentRank ? next : current
  }
  const currentTs = recordSyncTimestamp(current)
  const nextTs = recordSyncTimestamp(next)
  if (nextTs !== currentTs) {
    return nextTs > currentTs ? next : current
  }
  const currentTraceLen = current.liveTrace?.length ?? 0
  const nextTraceLen = next.liveTrace?.length ?? 0
  return nextTraceLen >= currentTraceLen ? next : current
}

function dedupeRecordsByQueryId(records: TraskHistoryRecordDto[]): TraskHistoryRecordDto[] {
  const byId = new Map<string, TraskHistoryRecordDto>()
  for (const record of records) {
    const existing = byId.get(record.queryId)
    if (!existing) {
      byId.set(record.queryId, record)
      continue
    }
    byId.set(record.queryId, pickPreferredRecord(existing, record))
  }
  return [...byId.values()]
}

function mapTraskHistoryToMessages(records: TraskHistoryRecordDto[]): MessageType[] {
  const sorted = dedupeRecordsByQueryId(records).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const syncedMessages: MessageType[] = []
  for (const rec of sorted) {
    if (isCanceledTraskRecord(rec)) continue
    syncedMessages.push({
      id: `srv-${rec.queryId}-u`,
      role: 'user',
      content: rec.query,
      timestamp: Date.parse(rec.createdAt) || Date.now(),
    })
    const assistantMessage = createAssistantMessageFromTraskRecord(rec, 'general')
    if (assistantMessage) {
      syncedMessages.push(assistantMessage)
    } else if (rec.status === 'complete') {
      syncedMessages.push(createDegradedMessageFromTraskRecord(rec, 'general'))
    } else if (rec.status === 'failed') {
      syncedMessages.push(createFailedMessageFromTraskRecord(rec, 'general'))
    } else {
      syncedMessages.push(createResearchLoadingMessage(
        `srv-${rec.queryId}-pending`,
        rec.query,
        Date.parse(rec.completedAt ?? rec.createdAt) || Date.now(),
        'general',
        mapResearchStepsFromRecord(rec),
      ))
    }
  }
  return ensureUniqueMessageIds(syncedMessages)
}

function shortFluxWords(text: string, cap = 3): string {
  return text
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}-]/gu, ''))
    .filter(Boolean)
    .slice(0, cap)
    .join(' ')
}

function scheduleQueryFluxShards(query: string, append: (words: string, zone: HolocronSourceZone) => void): void {
  const trimmed = query.trim()
  const tokens = fluxTokensFromQuery(trimmed)
  if (tokens.length === 0) {
    append(shortFluxWords(trimmed), zoneFromQueryKeyTerms(trimmed))
    return
  }
  const base = zoneFromQueryKeyTerms(trimmed)
  tokens.forEach((tok, i) => {
    window.setTimeout(() => {
      append(tok, i === 0 ? base : shardZoneForToken(trimmed, tok, i))
    }, i * 110)
  })
}

/** Outbound glyphs: token stream from the answer, striped across zones that actually fired. */
function scheduleAnswerFluxShards(
  answer: string,
  zones: HolocronSourceZone[],
  append: (words: string, zone: HolocronSourceZone) => void,
): void {
  if (zones.length === 0) return
  const trimmed = answer.trim()
  const tokens = fluxTokensFromQuery(trimmed, 10)
  if (tokens.length === 0) {
    const fallback = shortFluxWords(trimmed, 4)
    zones.forEach((z, i) => {
      window.setTimeout(() => append(fallback, z), i * 80)
    })
    return
  }
  tokens.forEach((tok, i) => {
    const zone = zones[i % zones.length]!
    window.setTimeout(() => append(tok, zone), i * 95)
  })
}

function prunePendingResearchTurns(messages: MessageType[], jobs: HolocronResearchJob[]): MessageType[] {
  if (jobs.length === 0) return messages
  const pendingAssistantIds = new Set<string>()
  const pendingQuestions = new Set<string>()
  for (const job of jobs) {
    pendingAssistantIds.add(job.assistantMessageId)
    if (job.serverQueryId) pendingAssistantIds.add(`srv-${job.serverQueryId}-pending`)
    pendingQuestions.add(job.question.trim().toLowerCase())
  }

  const skip = new Set<number>()
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!
    const prev = i > 0 ? messages[i - 1] : undefined
    const isPendingAssistant = message.role === 'assistant'
      && (pendingAssistantIds.has(message.id) || isResearchLoadingMessage(message))
    if (!isPendingAssistant) continue
    skip.add(i)
    if (prev?.role === 'user' && pendingQuestions.has(prev.content.trim().toLowerCase())) {
      skip.add(i - 1)
    }
  }

  return messages.filter((_, index) => !skip.has(index))
}

function App() {
  const [conversations, setConversations] = usePersistentLocalState<Conversation[]>(CONVERSATIONS_KEY, loadInitialConversations())
  const [activeConversationId, setActiveConversationId] = usePersistentLocalState<string | null>('active-conversation-id', null)
  const [sourceWeights, setSourceWeights] = usePersistentLocalState<SourceWeight[]>('source-weights', DEFAULT_SOURCE_WEIGHTS)
  const effectiveSourceWeights = useMemo(() => mergeSourceWeights(sourceWeights), [sourceWeights])
  const [traskApiKey, setTraskApiKey] = usePersistentLocalState<string>('qa-trask-web-api-key', '')
  const [researchJobs, setResearchJobs] = usePersistentLocalState<HolocronResearchJob[]>(HOLOCRON_RESEARCH_JOBS_KEY, [])
  const [selectedTraskModel, setSelectedTraskModel] = usePersistentLocalState<string>('holocron-trask-model', TRASK_MODEL_AUTO)
  const [traskModelOptions, setTraskModelOptions] = useState<readonly TraskModelOption[]>(() => mergeTraskModelOptions([]))
  const [sidebarWidth, setSidebarWidth] = usePersistentLocalState<number>('holocron-sidebar-width', 320)
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentLocalState<boolean>('holocron-sidebar-collapsed', false)
  const [input, setInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [activeAgents, setActiveAgents] = useState<AgentResult[]>([])
  const [currentQueryType, setCurrentQueryType] = useState<QueryType>('general')
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false)
  const [isPromptsOpen, setIsPromptsOpen] = useState(false)
  const [holocronSession, setHolocronSession] = useState<HolocronSessionUi>(() =>
    !legacySparkMode && traskUsesSameOriginApi() ? { status: 'loading' } : { status: 'anonymous', oauthAvailable: false },
  )
  const [holocronThreadId, setHolocronThreadId] = useState('')
  const [queryFlux, setQueryFlux] = useState<HolocronFluxEvent[]>([])
  const [answerFlux, setAnswerFlux] = useState<HolocronFluxEvent[]>([])
  const [sourceMetrics, setSourceMetrics] = useState<Record<HolocronSourceZone, number>>({
    deadlystream: 0,
    lucasforums: 0,
    kotor: 0,
    modding: 0,
    core: 0,
  })
  const [holocronInteractionCount, setHolocronInteractionCount] = useState(0)
  const [holocronAnswerBondTicks, setHolocronAnswerBondTicks] = useState(0)
  const [holocronLiveQuery, setHolocronLiveQuery] = useState('')
  const [livePulses, setLivePulses] = useState<HolocronRetrievalPulse[]>([])
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [isMobileViewport, setIsMobileViewport] = useState(false)
  const traceSeenRef = useRef<Set<string>>(new Set())
  const { prompts } = usePrompts()
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const researchWorkersRef = useRef<Set<string>>(new Set())
  const researchConversationWorkersRef = useRef<Set<string>>(new Set())
  const researchJobsRef = useRef<HolocronResearchJob[]>([])
  const shouldStickToBottomRef = useRef(true)
  const jumpVisibleRef = useRef(false)
  const mobileSidebarRef = useRef<HTMLDivElement>(null)
  const mobileSidebarToggleButtonRef = useRef<HTMLButtonElement>(null)
  const lastFocusedElementRef = useRef<HTMLElement | null>(null)

  const updateScrollStickiness = useCallback(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    const remaining = el.scrollHeight - el.scrollTop - el.clientHeight
    const nearBottom = remaining <= 120
    const hasOverflow = el.scrollHeight > el.clientHeight + 1
    const nextJumpVisible = hasOverflow && !nearBottom
    shouldStickToBottomRef.current = nearBottom
    if (jumpVisibleRef.current !== nextJumpVisible) {
      jumpVisibleRef.current = nextJumpVisible
      setShowJumpToLatest(nextJumpVisible)
    }
  }, [])

  const jumpToLatest = useCallback(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    el.scrollTop = el.scrollHeight
    shouldStickToBottomRef.current = true
    jumpVisibleRef.current = false
    setShowJumpToLatest(false)
  }, [])

  const activeConversation = (conversations || []).find(c => c.id === activeConversationId)
  const messages = useMemo(
    () => ensureUniqueMessageIds(activeConversation?.messages || []),
    [activeConversation?.messages],
  )
  const activeConversationResearchJobs = useMemo(
    () => activeConversationId
      ? normalizeResearchJobs(researchJobs).filter((job) => job.conversationId === activeConversationId)
      : [],
    [activeConversationId, researchJobs],
  )
  const hasRunningResearch = !legacySparkMode && activeConversationResearchJobs.length > 0
  const queryInputLocked = isProcessing
  const effectiveTraskModelOptions = traskModelOptions.length ? traskModelOptions : TRASK_MODEL_OPTIONS

  useEffect(() => {
    researchJobsRef.current = normalizeResearchJobs(researchJobs)
  }, [researchJobs])

  useEffect(() => {
    if (legacySparkMode || !traskUsesSameOriginApi()) return
    let cancelled = false
    void traskListModels(traskApiKey || undefined)
      .then((models) => {
        if (!cancelled) {
          setTraskModelOptions(mergeTraskModelOptions(models))
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTraskModelOptions(mergeTraskModelOptions([]))
        }
      })
    return () => {
      cancelled = true
    }
  }, [traskApiKey])

  useEffect(() => {
    const normalized = normalizeTraskModelSelection(selectedTraskModel, effectiveTraskModelOptions)
    if (selectedTraskModel !== normalized) {
      setSelectedTraskModel(normalized)
    }
  }, [effectiveTraskModelOptions, selectedTraskModel, setSelectedTraskModel])

  const starterSuggestions = useMemo(
    () => priorUserQuestionsFromOtherThreads(conversations || [], activeConversationId ?? null),
    [conversations, activeConversationId],
  )

  const syncThreadFromRemote = useCallback(
    (
      records: TraskHistoryRecordDto[],
      opts?: { animateTrace?: boolean; prependLocals?: MessageType[]; threadId?: string },
    ) => {
      const targetThreadId = opts?.threadId ?? holocronThreadId
      if (!targetThreadId) return
      const targetRecords = records.filter((rec) => rec.threadId === targetThreadId)
      const animateTrace = (opts?.animateTrace ?? true) && targetThreadId === holocronThreadId
      const prependLocals = opts?.prependLocals ?? []
      if (!legacySparkMode && traskUsesSameOriginApi() && animateTrace) {
        const seen = traceSeenRef.current
        const pulses: HolocronRetrievalPulse[] = []
        const zonesRank = new Map<HolocronSourceZone, number>()
        for (const rec of targetRecords) {
          const trace = rec.liveTrace ?? []
          for (let i = 0; i < trace.length; i++) {
            const ev = trace[i]!
            const dedupeKey = `${rec.queryId}:${ev.at}:${ev.phase}:${ev.detail ?? ''}:${i}`
            if (seen.has(dedupeKey)) continue
            seen.add(dedupeKey)
            if (!animateTrace) continue
            const phase = (ev.phase ?? '').toLowerCase()
            const dir: 'in' | 'out' =
              phase === 'sources' || phase === 'compose' ? 'out' : 'in'
            let zone: HolocronSourceZone = 'core'
            if (dir === 'out' && ev.sources?.length) {
              const targets = ev.sources.map((s) => zoneFromSourceLabel(`${s.name} ${s.url}`))
              zone = targets[i % targets.length]!
              for (const z of targets) {
                zonesRank.set(z, (zonesRank.get(z) ?? 0) + 1)
              }
            } else if (dir === 'in' && ev.sources?.length) {
              const targets = ev.sources.map((s) => zoneFromSourceLabel(`${s.name} ${s.url}`))
              zone = targets[0]!
              for (const z of targets) {
                zonesRank.set(z, (zonesRank.get(z) ?? 0) + 1)
              }
            } else {
              zone =
                phase === 'gather'
                  ? zoneFromQueryKeyTerms(rec.query)
                  : shardZoneForToken(rec.query, `${phase}:${ev.detail ?? ''}`, i)
            }
            pulses.push({
              id: `srv-pulse-${dedupeKey}`,
              words: pulseWordsFromTrace(ev, rec),
              zone,
              direction: dir,
              createdAt: Date.now(),
            })
          }
        }
        if (pulses.length) {
          setLivePulses((cur) => [...cur.slice(-48), ...pulses])
          for (const [zone, n] of zonesRank) {
            setSourceMetrics((c) => ({ ...c, [zone]: (c[zone] ?? 0) + n }))
          }
          setHolocronInteractionCount((n) => n + pulses.length)
        }
        saveSeenTraceKeys(targetThreadId, seen)
      }

      const convId = holocronConversationId(targetThreadId)
      setConversations((current) => {
        const list = current || []
        const prev = list.find((c) => c.id === convId)
        const localBase = [...prependLocals, ...(prev?.messages ?? [])]
        const merged = mergeHolocronThreadMessages(localBase, targetRecords)
        const firstUser = merged.find((m) => m.role === 'user')
        const raw = firstUser?.content?.trim() ?? ''
        const title = raw
          ? raw.substring(0, 50) + (raw.length > 50 ? '...' : '')
          : 'Trask · Holocron'
        const updatedAt = conversationUpdatedAtFromMessages(merged, prev?.updatedAt ?? Date.now())
        const conv: Conversation = {
          id: convId,
          title,
          messages: merged,
          createdAt: prev?.createdAt ?? Date.now(),
          updatedAt,
        }
        if (prev) {
          return list.map((candidate) => candidate.id === convId ? conv : candidate)
        }
        return [conv, ...list]
      })
      setActiveConversationId((current) => current ?? convId)
    },
    [holocronThreadId, legacySparkMode],
  )

  useEffect(() => {
    if (legacySparkMode || !traskUsesSameOriginApi() || !holocronThreadId) {
      traceSeenRef.current = new Set()
      return
    }
    traceSeenRef.current = loadSeenTraceKeys(holocronThreadId)
    let cancelled = false
    const tick = async () => {
      try {
        const remote = await traskGetThread(holocronThreadId, traskApiKey || undefined)
        if (cancelled) return
        syncThreadFromRemote(remote, { animateTrace: true, threadId: holocronThreadId })
      } catch {
        /* ignore transient errors */
      }
    }
    void tick()
    const id = window.setInterval(() => void tick(), 900)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [holocronThreadId, legacySparkMode, syncThreadFromRemote, traskApiKey])

  useEffect(() => {
    const id = window.setInterval(() => {
      const cutoff = Date.now() - 2800
      setLivePulses((cur) => cur.filter((p) => p.createdAt > cutoff))
    }, 400)
    return () => window.clearInterval(id)
  }, [])

  const handleCreateConversation = () => {
    if (!legacySparkMode && traskUsesSameOriginApi()) {
      const tid = crypto.randomUUID()
      const params = new URLSearchParams(window.location.search)
      params.set('thread', tid)
      const qs = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
      setHolocronThreadId(tid)
      traceSeenRef.current = new Set()
      setLivePulses([])
      const convId = holocronConversationId(tid)
      const newConversation: Conversation = {
        id: convId,
        title: 'New Holocron thread',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      setConversations((current) => {
        const list = current || []
        const others = list.filter((c) => c.id !== convId)
        return [...others, newConversation]
      })
      setActiveConversationId(convId)
      if (isMobileViewport) {
        setSidebarCollapsed(true)
      }
      try {
        sessionStorage.removeItem(`holocron-ephemeral-${tid}`)
      } catch {
        /* ignore */
      }
      return
    }

    const newConversation: Conversation = {
      id: `conv-${Date.now()}`,
      title: 'New Conversation',
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    setConversations((current) => [...(current || []), newConversation])
    setActiveConversationId(newConversation.id)
    if (isMobileViewport) {
      setSidebarCollapsed(true)
    }
  }

  const handleSidebarResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (sidebarCollapsed) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = clampSidebarWidth(sidebarWidth)

    const onMouseMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX
      setSidebarWidth(clampSidebarWidth(startWidth + delta))
    }

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [setSidebarWidth, sidebarCollapsed, sidebarWidth])

  useKeyboardShortcuts([
    {
      key: 'n',
      ctrlKey: true,
      handler: handleCreateConversation,
      description: 'New conversation',
    },
    {
      key: 'n',
      metaKey: true,
      handler: handleCreateConversation,
      description: 'New conversation',
    },
    {
      key: 'k',
      ctrlKey: true,
      handler: () => searchInputRef.current?.focus(),
      description: 'Focus search',
    },
    {
      key: 'k',
      metaKey: true,
      handler: () => searchInputRef.current?.focus(),
      description: 'Focus search',
    },
    {
      key: '/',
      ctrlKey: true,
      handler: () => setIsShortcutsOpen(true),
      description: 'Show shortcuts',
    },
    {
      key: '/',
      metaKey: true,
      handler: () => setIsShortcutsOpen(true),
      description: 'Show shortcuts',
    },
    {
      key: 'p',
      ctrlKey: true,
      shiftKey: true,
      handler: () => setIsPromptsOpen(true),
      description: 'Edit AI prompts',
    },
    {
      key: 'p',
      metaKey: true,
      shiftKey: true,
      handler: () => setIsPromptsOpen(true),
      description: 'Edit AI prompts',
    },
  ], !isSettingsOpen && !isShortcutsOpen && !isPromptsOpen)

  useEffect(() => {
    if (!legacySparkMode && traskUsesSameOriginApi()) {
      return
    }
    if (!activeConversationId && (conversations || []).length === 0) {
      handleCreateConversation()
    }
  }, [])

  useEffect(() => {
    if (legacySparkMode || !traskUsesSameOriginApi()) {
      return
    }
    const params = new URLSearchParams(window.location.search)
    let tid = params.get('thread')?.trim() ?? ''
    if (!isHolocronThreadId(tid)) {
      tid = crypto.randomUUID()
      params.set('thread', tid)
      const qs = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }
    setHolocronThreadId(tid)
  }, [legacySparkMode])

  /**
   * Sync activeConversationId → holocronThreadId & URL to prevent swapping.
   * When user selects a Holocron conversation in the sidebar, both the thread ID state
   * and the URL parameter must update together, so polling/routing stays consistent.
   */
  useEffect(() => {
    if (legacySparkMode || !traskUsesSameOriginApi() || !activeConversationId) {
      return
    }
    if (!activeConversationId.startsWith('holocron-')) {
      return
    }
    const threadId = activeConversationId.replace('holocron-', '')
    if (!isHolocronThreadId(threadId)) {
      return
    }
    // Update local state: trigger polling/remote fetch for this thread
    if (holocronThreadId !== threadId) {
      setHolocronThreadId(threadId)
    }
    // Update URL: ensure the ?thread parameter matches the active conversation
    const params = new URLSearchParams(window.location.search)
    const currentThread = params.get('thread')?.trim()
    if (currentThread !== threadId) {
      params.set('thread', threadId)
      const qs = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`)
    }
  }, [activeConversationId, legacySparkMode]) // Intentionally exclude holocronThreadId to avoid re-triggering



  /** Holocron: create shell + select thread immediately so the composer is never blocked on session/history fetch. */
  useEffect(() => {
    if (legacySparkMode || !traskUsesSameOriginApi() || !holocronThreadId) {
      return
    }
    const convId = holocronConversationId(holocronThreadId)
    setConversations((current) => {
      const list = current || []
      if (list.some((c) => c.id === convId)) {
        return list
      }
      const shell: Conversation = {
        id: convId,
        title: 'New Holocron thread',
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      return [shell, ...list.filter((c) => c.id !== convId)]
    })
    setActiveConversationId(convId)
  }, [holocronThreadId, legacySparkMode])

  useEffect(() => {
    if (legacySparkMode || !traskUsesSameOriginApi() || !holocronThreadId) {
      return
    }

    let cancelled = false
    const convId = holocronConversationId(holocronThreadId)
    const ephemeralKey = `holocron-ephemeral-${holocronThreadId}`

    void (async () => {
      const session = await traskFetchSession()
      if (cancelled) return

      const loadEphemeralPrepend = (): MessageType[] => {
        try {
          const raw = sessionStorage.getItem(ephemeralKey)
          if (!raw) return []
          const parsed: unknown = JSON.parse(raw)
          return isMessageArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }

      if (!session) {
        setHolocronSession({ status: 'anonymous', oauthAvailable: false })
        try {
          const remote = await traskGetThread(holocronThreadId, traskApiKey || undefined)
          if (cancelled) return
          syncThreadFromRemote(remote, { animateTrace: false, prependLocals: loadEphemeralPrepend(), threadId: holocronThreadId })
        } catch {
          if (!cancelled) {
            syncThreadFromRemote([], { animateTrace: false, prependLocals: loadEphemeralPrepend(), threadId: holocronThreadId })
          }
        }
        return
      }

      if (!session.loggedIn || !session.discord) {
        setHolocronSession({
          status: 'anonymous',
          oauthAvailable: Boolean(session.oauthAvailable),
        })
        try {
          const remote = await traskGetThread(holocronThreadId, traskApiKey || undefined)
          if (cancelled) return
          syncThreadFromRemote(remote, { animateTrace: false, prependLocals: loadEphemeralPrepend(), threadId: holocronThreadId })
        } catch {
          if (!cancelled) {
            syncThreadFromRemote([], { animateTrace: false, prependLocals: loadEphemeralPrepend(), threadId: holocronThreadId })
          }
        }
        return
      }

      try {
        const history = await traskListHistory(100, traskApiKey || undefined, holocronThreadId)
        if (cancelled) return
        syncThreadFromRemote(history, { animateTrace: false, threadId: holocronThreadId })
      } catch {
        // Background research jobs keep local state alive and retry when the server returns.
      }

      if (!cancelled) {
        setHolocronSession({
          status: 'loggedIn',
          discord: {
            username: session.discord.username,
            displayName: session.discord.displayName || session.discord.username,
          },
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [holocronThreadId, legacySparkMode, syncThreadFromRemote, traskApiKey])

  useEffect(() => {
    if (legacySparkMode || !traskUsesSameOriginApi() || !holocronThreadId) {
      return
    }
    if (holocronSession.status !== 'anonymous') {
      return
    }
    const convId = holocronConversationId(holocronThreadId)
    const conv = (conversations || []).find((c) => c.id === convId)
    if (!conv) {
      return
    }
    try {
      sessionStorage.setItem(`holocron-ephemeral-${holocronThreadId}`, JSON.stringify(conv.messages))
    } catch {
      /* ignore */
    }
  }, [conversations, holocronSession.status, holocronThreadId, legacySparkMode])

  useEffect(() => {
    if (!scrollRef.current || !shouldStickToBottomRef.current) {
      return
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, activeAgents])

  useEffect(() => {
    updateScrollStickiness()
  }, [messages.length, activeAgents.length, updateScrollStickiness])

  useEffect(() => {
    const id = window.setTimeout(() => setHolocronLiveQuery(input.trim()), 120)
    return () => window.clearTimeout(id)
  }, [input])

  useEffect(() => {
    const id = window.setInterval(() => {
      const cutoff = Date.now() - 3400
      setQueryFlux((current) => current.filter((e) => e.createdAt > cutoff))
      setAnswerFlux((current) => current.filter((e) => e.createdAt > cutoff))
    }, 640)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const media = window.matchMedia('(max-width: 767px)')
    const sync = () => setIsMobileViewport(media.matches)
    sync()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', sync)
      return () => media.removeEventListener('change', sync)
    }
    media.addListener(sync)
    return () => media.removeListener(sync)
  }, [])

  useEffect(() => {
    if (isMobileViewport) {
      setSidebarCollapsed(true)
    }
  }, [isMobileViewport, setSidebarCollapsed])

  useEffect(() => {
    if (!isMobileViewport || sidebarCollapsed) {
      return
    }

    lastFocusedElementRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    const focusSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

    const focusFirstInDrawer = () => {
      const root = mobileSidebarRef.current
      if (!root) return
      const firstFocusable = root.querySelector<HTMLElement>(focusSelector)
      firstFocusable?.focus()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSidebarCollapsed(true)
        return
      }
      if (event.key !== 'Tab') {
        return
      }
      const root = mobileSidebarRef.current
      if (!root) {
        return
      }
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(focusSelector))
      if (focusables.length === 0) {
        return
      }

      const first = focusables[0]!
      const last = focusables[focusables.length - 1]!
      const active = document.activeElement as HTMLElement | null

      if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      }
    }

    focusFirstInDrawer()
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      const canFocus = (el: HTMLElement | null): el is HTMLElement =>
        Boolean(el && !el.hasAttribute('disabled') && el.getClientRects().length > 0)
      if (canFocus(mobileSidebarToggleButtonRef.current)) {
        mobileSidebarToggleButtonRef.current.focus()
      } else if (canFocus(lastFocusedElementRef.current)) {
        lastFocusedElementRef.current.focus()
      }
    }
  }, [isMobileViewport, setSidebarCollapsed, sidebarCollapsed])

  const handleSelectConversation = (id: string) => {
    setActiveConversationId(id)
    if (isMobileViewport) {
      setSidebarCollapsed(true)
    }
  }

  const handleRenameConversation = (id: string, newTitle: string) => {
    setConversations((current) =>
      (current || []).map((conv) =>
        conv.id === id ? { ...conv, title: newTitle } : conv
      )
    )
  }

  const handleDeleteConversation = (id: string) => {
    setConversations((current) => {
      const remaining = (current || []).filter((conv) => conv.id !== id)
      if (activeConversationId === id) {
        setActiveConversationId(remaining.length > 0 ? remaining[0].id : null)
      }
      return remaining
    })
  }

  const handleImportConversations = (importedConversations: Conversation[], importedSourceWeights?: SourceWeight[]) => {
    setConversations(importedConversations)
    if (importedSourceWeights) {
      setSourceWeights(importedSourceWeights)
    }
    if (importedConversations.length > 0) {
      setActiveConversationId(importedConversations[0].id)
    }
    if (isMobileViewport) {
      setSidebarCollapsed(true)
    }
  }

  const updateConversation = (conversationId: string, updatedMessages: MessageType[]) => {
    setConversations((current) =>
      (current || []).map((conv) => {
        if (conv.id === conversationId) {
          const firstUserMessage = updatedMessages.find(m => m.role === 'user')
          const q = firstUserMessage?.content?.trim()
          const title = q
            ? q.substring(0, 50) + (q.length > 50 ? '...' : '')
            : conversationDisplayTitle(conv.title)

          return {
            ...conv,
            messages: updatedMessages,
            title,
            updatedAt: conversationUpdatedAtFromMessages(updatedMessages, conv.updatedAt),
          }
        }
        return conv
      })
    )
  }

  const appendQueryFlux = useCallback((words: string, zone: HolocronSourceZone = 'core') => {
    if (!words) return
    setQueryFlux((current) => [
      ...current.slice(-34),
      { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, words, zone, createdAt: Date.now() },
    ])
  }, [])

  const appendAnswerFlux = useCallback((words: string, zone: HolocronSourceZone) => {
    if (!words) return
    setAnswerFlux((current) => [
      ...current.slice(-34),
      { id: `a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, words, zone, createdAt: Date.now() },
    ])
  }, [])

  const replaceResearchAssistantMessage = useCallback(
    (job: HolocronResearchJob, assistantMessage: MessageType) => {
      setConversations((current) =>
        (current || []).map((conv) => {
          if (conv.id !== job.conversationId) return conv
          const serverPendingId = job.serverQueryId ? `srv-${job.serverQueryId}-pending` : undefined
          const placeholderIndex = conv.messages.findIndex((msg) =>
            msg.id === job.assistantMessageId || (serverPendingId ? msg.id === serverPendingId : false)
          )
          const normalizedQuestion = job.question.trim().toLowerCase()
          const matchingLoadingIndex = conv.messages.findIndex((msg, index) => {
            if (!isResearchLoadingMessage(msg)) return false
            return conv.messages
              .slice(0, index)
              .some((candidate) => candidate.role === 'user' && candidate.content.trim().toLowerCase() === normalizedQuestion)
          })
          const replaceIndex = placeholderIndex >= 0 ? placeholderIndex : matchingLoadingIndex
          const hasServerAnswer = conv.messages.some((msg) => msg.id === assistantMessage.id)
          const updatedMessages = replaceIndex >= 0
            ? conv.messages.map((msg, index) => (index === replaceIndex ? assistantMessage : msg))
            : hasServerAnswer
              ? conv.messages
              : [...conv.messages, assistantMessage]
          const nextMessages = updatedMessages.filter((msg, index) => {
            if (index === replaceIndex || msg.id === assistantMessage.id) return true
            if (!isResearchLoadingMessage(msg)) return true
            return !updatedMessages
              .slice(0, index)
              .some((candidate) => candidate.role === 'user' && candidate.content.trim().toLowerCase() === normalizedQuestion)
          })
          return {
            ...conv,
            messages: nextMessages,
            updatedAt: conversationUpdatedAtFromMessages(nextMessages, conv.updatedAt),
          }
        })
      )
    },
    [setConversations],
  )

  const failResearchJob = useCallback(
    (job: HolocronResearchJob, record: TraskHistoryRecordDto) => {
      replaceResearchAssistantMessage(job, createFailedMessageFromTraskRecord(record, job.queryType))
      setResearchJobs((current) => normalizeResearchJobs(current).filter((candidate) => candidate.clientId !== job.clientId))
      if (job.conversationId === activeConversationId) {
        setActiveAgents([])
      }
    },
    [activeConversationId, replaceResearchAssistantMessage, setResearchJobs],
  )

  const completeResearchJob = useCallback(
    (job: HolocronResearchJob, record: TraskHistoryRecordDto) => {
      const assistantMessage = createAssistantMessageFromTraskRecord(record, job.queryType)
        ?? createDegradedMessageFromTraskRecord(record, job.queryType)
      replaceResearchAssistantMessage(job, assistantMessage)
      setResearchJobs((current) => normalizeResearchJobs(current).filter((candidate) => candidate.clientId !== job.clientId))
      if (job.conversationId === activeConversationId) {
        setActiveAgents(assistantMessage.agentResults ?? [])
        setCurrentQueryType(job.queryType)
      }
      setHolocronAnswerBondTicks((n) => n + 1)
      const touchedZones = new Set<HolocronSourceZone>()
      for (const src of record.sources ?? []) {
        const zone = zoneFromSourceLabel(`${src.name} ${src.url}`)
        touchedZones.add(zone)
        setSourceMetrics((current) => ({
          ...current,
          [zone]: (current[zone] ?? 0) + 1,
        }))
      }
      if (touchedZones.size === 0) touchedZones.add('core')
      scheduleAnswerFluxShards(assistantMessage.content, Array.from(touchedZones), appendAnswerFlux)
      setHolocronInteractionCount((n) => n + 1 + touchedZones.size)
    },
    [activeConversationId, appendAnswerFlux, replaceResearchAssistantMessage, setResearchJobs],
  )

  useEffect(() => {
    if (legacySparkMode) return
    const activeJob = normalizeResearchJobs(researchJobs).find((job) => job.conversationId === activeConversationId)
    if (!activeJob) {
      setActiveAgents((current) => current.some((agent) => agent.status === 'retrieving') ? [] : current)
      return
    }
    setCurrentQueryType(activeJob.queryType)
    setActiveAgents([traskRetrievingAgent(activeJob.question)])
  }, [activeConversationId, researchJobs])

  useEffect(() => {
    if (legacySparkMode) return
    let cancelled = false

    const patchResearchJob = (
      job: HolocronResearchJob,
      patch: Partial<HolocronResearchJob> | ((current: HolocronResearchJob) => Partial<HolocronResearchJob>),
    ) => {
      setResearchJobs((current) =>
        normalizeResearchJobs(current).map((candidate) => {
          if (candidate.clientId !== job.clientId) return candidate
          const resolved = typeof patch === 'function' ? patch(candidate) : patch
          return {
            ...candidate,
            ...resolved,
            updatedAt: Date.now(),
          }
        })
      )
    }

    const retryLater = (job: HolocronResearchJob, patch?: Partial<HolocronResearchJob>) => {
      patchResearchJob(job, (current) => {
        const attemptCount = current.attemptCount + 1
        return {
          ...patch,
          attemptCount,
          nextAttemptAt: Date.now() + researchRetryDelayMs(attemptCount),
        }
      })
    }

    const pollLater = (job: HolocronResearchJob, patch?: Partial<HolocronResearchJob>) => {
      patchResearchJob(job, (current) => ({
        ...patch,
        nextAttemptAt: Date.now() + 2_500,
        pollFailures: (patch?.pollFailures ?? current.pollFailures),
      }))
    }

    const processJob = async (job: HolocronResearchJob) => {
      if (
        cancelled
        || researchWorkersRef.current.has(job.clientId)
        || researchConversationWorkersRef.current.has(job.conversationId)
      ) return
      researchWorkersRef.current.add(job.clientId)
      researchConversationWorkersRef.current.add(job.conversationId)
      const isJobCurrent = () => researchJobsRef.current.some((candidate) => candidate.clientId === job.clientId)
      try {
        if (!isJobCurrent()) return
        // Only seed/repair the placeholder once. Replacing it every poll can clobber live trace steps.
        if (!job.serverQueryId && job.attemptCount === 0) {
          replaceResearchAssistantMessage(job, createResearchLoadingMessage(
            job.assistantMessageId,
            job.question,
            job.createdAt,
            job.queryType,
            [
              localResearchStep('queued', 'Persisted locally; continuing in the background.'),
              localResearchStep('dispatch', 'Dispatching query to Trask research backend.'),
            ],
          ))
        }
        if (job.conversationId === activeConversationId) {
          setCurrentQueryType(job.queryType)
          setActiveAgents([traskRetrievingAgent(job.question)])
        }

        if (job.serverQueryId) {
          const history = await traskGetThread(job.threadId, traskApiKey || undefined, traskPollIterationSignal())
          if (cancelled || !isJobCurrent()) return
          syncThreadFromRemote(history, { animateTrace: true, threadId: job.threadId })
          const normalizedQuestion = job.question.trim().toLowerCase()
          const record = history.find((rec) => rec.queryId === job.serverQueryId)
            ?? history.find((rec) => rec.query.trim().toLowerCase() === normalizedQuestion)
          if (record?.status === 'complete') {
            completeResearchJob(job, record)
            return
          }
          if (record && isCanceledTraskRecord(record)) {
            setResearchJobs((current) => normalizeResearchJobs(current).filter((candidate) => candidate.clientId !== job.clientId))
            return
          }
          if (record?.status === 'failed') {
            failResearchJob(job, record)
            return
          }
          const pollFailures = record ? 0 : job.pollFailures + 1
          // Missing record can be eventual-consistency or transient backend lag; do not re-dispatch.
          if (!record && pollFailures >= RESEARCH_POLL_FAILURE_GIVE_UP) {
            retryLater(job, { state: 'submitted', pollFailures: 0, serverQueryId: undefined })
            return
          }
          pollLater(job, { state: 'submitted', pollFailures })
          return
        }

        const record = await traskAsk(
          job.question,
          traskApiKey || undefined,
          job.threadId,
          modelPayloadValue(job.modelId),
          mergeSourceWeights(job.sourceWeights ?? effectiveSourceWeights),
        )
        if (cancelled || !isJobCurrent()) return
        if (record.status === 'complete') {
          completeResearchJob(job, record)
          return
        }
        patchResearchJob(job, {
          serverQueryId: record.queryId,
          state: 'submitted',
          attemptCount: 0,
          pollFailures: 0,
          nextAttemptAt: Date.now() + 1_500,
        })
      } catch {
        if (!cancelled) {
          retryLater(job)
        }
      } finally {
        researchWorkersRef.current.delete(job.clientId)
        researchConversationWorkersRef.current.delete(job.conversationId)
      }
    }

    const runDueJobs = () => {
      const now = Date.now()
      const dueJobs: HolocronResearchJob[] = []
      const selectedConversations = new Set<string>()
      for (const job of normalizeResearchJobs(researchJobs)
        .filter((candidate) => candidate.nextAttemptAt <= now)
        .sort((left, right) => left.createdAt - right.createdAt)) {
        if (selectedConversations.has(job.conversationId)) continue
        if (researchConversationWorkersRef.current.has(job.conversationId)) continue
        selectedConversations.add(job.conversationId)
        dueJobs.push(job)
      }
      dueJobs
        .filter((job) => job.nextAttemptAt <= now)
        .slice(0, 4)
        .forEach((job) => {
          void processJob(job)
        })
    }

    runDueJobs()
    const timer = window.setInterval(runDueJobs, 2_500)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [
    activeConversationId,
    completeResearchJob,
    failResearchJob,
    replaceResearchAssistantMessage,
    researchJobs,
    setResearchJobs,
    syncThreadFromRemote,
    traskApiKey,
  ])

  const handleToggleExpand = useCallback((id: string) => {
    if (!activeConversationId) return

    const updatedMessages = messages.map((msg) =>
      msg.id === id ? { ...msg, isExpanded: !msg.isExpanded } : msg
    )
    updateConversation(activeConversationId, updatedMessages)
  }, [activeConversationId, messages])

  const cancelConversationResearch = useCallback((conversationId: string): HolocronResearchJob[] => {
    const jobs = researchJobsRef.current.filter((job) => job.conversationId === conversationId)
    if (jobs.length === 0) return []

    for (const job of jobs) {
      if (job.serverQueryId) {
        void traskCancelQuery(job.serverQueryId, traskApiKey || undefined).catch(() => undefined)
      }
      researchWorkersRef.current.delete(job.clientId)
      researchConversationWorkersRef.current.delete(job.conversationId)
    }

    setResearchJobs((current) => normalizeResearchJobs(current).filter((job) => job.conversationId !== conversationId))
    setConversations((current) =>
      (current || []).map((conv) => {
        if (conv.id !== conversationId) return conv
        const nextMessages = prunePendingResearchTurns(conv.messages, jobs)
        return {
          ...conv,
          messages: nextMessages,
          updatedAt: conversationUpdatedAtFromMessages(nextMessages, conv.updatedAt),
        }
      })
    )
    if (conversationId === activeConversationId) {
      setActiveAgents([])
    }
    return jobs
  }, [activeConversationId, setConversations, setResearchJobs, traskApiKey])

  const submitQuestion = async (rawQuestion: string) => {
    const trimmed = rawQuestion.trim()
    if (!trimmed || queryInputLocked || !activeConversationId) return
    const conversationId = activeConversationId
    const replacementJobs = !legacySparkMode ? cancelConversationResearch(conversationId) : []
    const baseMessages = replacementJobs.length ? prunePendingResearchTurns(messages, replacementJobs) : messages

    const userMessage: MessageType = {
      id: `msg-${Date.now()}-user`,
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
    }

    const newMessages = [...baseMessages, userMessage]
    updateConversation(conversationId, newMessages)
    setInput('')
    setIsProcessing(true)
    scheduleQueryFluxShards(userMessage.content, appendQueryFlux)
    setHolocronInteractionCount((n) => n + 1)

    try {
      const queryType = await classifyQueryType(userMessage.content)
      setCurrentQueryType(queryType)

      const relevance = legacySparkMode ? await detectQuestionRelevance(userMessage.content) : { isRelevant: true as const }

      if (legacySparkMode && !relevance.isRelevant) {
        const systemMessage: MessageType = {
          id: `msg-${Date.now()}-sys`,
          role: 'system',
          content:
            relevance.reason === 'too_short'
              ? 'Could you provide more details?'
              : 'I respond best to clear questions. Could you rephrase?',
          timestamp: Date.now(),
        }
        updateConversation(conversationId, [...newMessages, systemMessage])
        setIsProcessing(false)
        return
      }

      if (!legacySparkMode) {
        const retrieving: AgentResult[] = [traskRetrievingAgent(userMessage.content)]
        setActiveAgents(retrieving)
        const clientId = `research-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
        const candidateThreadId = conversationId.startsWith('holocron-')
          ? conversationId.replace('holocron-', '')
          : holocronThreadId
        const threadId = isHolocronThreadId(candidateThreadId)
          ? candidateThreadId
          : createHolocronThreadId()
        const assistantMessageId = `pending-${clientId}-a`
        const selectedModelId = normalizeTraskModelSelection(selectedTraskModel, effectiveTraskModelOptions)
        const pendingMessage = createResearchLoadingMessage(
          assistantMessageId,
          userMessage.content,
          Date.now(),
          queryType,
          [
            localResearchStep('queued', 'Queued in local background worker.'),
            localResearchStep('dispatch', `Preparing research request with ${traskModelLabel(selectedModelId, effectiveTraskModelOptions)}.`),
          ],
        )
        const researchJob: HolocronResearchJob = {
          clientId,
          conversationId,
          threadId,
          question: userMessage.content,
          assistantMessageId,
          modelId: selectedModelId,
          sourceWeights: effectiveSourceWeights,
          queryType,
          state: 'queued',
          attemptCount: 0,
          pollFailures: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          nextAttemptAt: Date.now(),
        }
        updateConversation(conversationId, [...newMessages, pendingMessage])
        if (holocronThreadId !== threadId && isHolocronThreadId(threadId)) {
          setHolocronThreadId(threadId)
        }
        setResearchJobs((current) => {
          const jobs = normalizeResearchJobs(current)
          const alreadyQueued = jobs.some((job) =>
            job.conversationId === researchJob.conversationId
          )
          return alreadyQueued ? jobs : [...jobs, researchJob]
        })
        return
      }

      const agentResults = await performMultiAgentRetrieval(userMessage.content, effectiveSourceWeights, prompts)
      setActiveAgents(agentResults)

      await new Promise((resolve) => setTimeout(resolve, 500))

      const answer = await aggregateAnswer(userMessage.content, agentResults, prompts)

      const assistantMessage: MessageType = {
        id: `msg-${Date.now()}-assistant`,
        role: 'assistant',
        content: answer.concise,
        expandedContent: answer.expanded,
        sources: answer.sources,
        timestamp: Date.now(),
        isExpanded: false,
        agentResults: agentResults,
        queryType: queryType,
      }

      updateConversation(conversationId, [...newMessages, assistantMessage])
      setHolocronAnswerBondTicks((n) => n + 1)
      const legacyZones = new Set<HolocronSourceZone>()
      for (const src of answer.sources) {
        const zone = zoneFromSourceLabel(`${src.name} ${src.url ?? ''}`)
        legacyZones.add(zone)
        setSourceMetrics((current) => ({
          ...current,
          [zone]: (current[zone] ?? 0) + 1,
        }))
      }
      if (legacyZones.size === 0) {
        legacyZones.add('core')
      }
      scheduleAnswerFluxShards(answer.concise, Array.from(legacyZones), appendAnswerFlux)
      setHolocronInteractionCount((n) => n + 1 + legacyZones.size)
      setActiveAgents([])
    } catch (error) {
      console.error('Error processing question:', error)
      toast.error('Something went wrong. Please try again.')
    } finally {
      setIsProcessing(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void submitQuestion(input)
  }

  const handleHolocronLogout = async () => {
    await traskLogout()
    const next = await traskFetchSession()
    setHolocronSession({
      status: 'anonymous',
      oauthAvailable: Boolean(next?.oauthAvailable),
    })
  }

  return (
    <div className="h-dvh flex flex-col bg-background relative overflow-x-hidden overflow-y-hidden">
      <TopNav holocronSession={holocronSession} onHolocronLogout={handleHolocronLogout} />

      <div className="flex-1 flex min-h-0 pt-14 relative">
        <div className="holocron-atmosphere pointer-events-none overflow-visible" aria-hidden>
          <div className="holocron-atmosphere__panel" />
          <div className="holocron-atmosphere__halftone" />
          <div className="holocron-atmosphere__wash" />
          <div className="holocron-atmosphere__gradient" />
          <div className="holocron-atmosphere__vignette" />
        </div>
        <HolocronSanctum
          queryFlux={queryFlux}
          answerFlux={answerFlux}
          sourceMetrics={sourceMetrics}
          totalInteractions={holocronInteractionCount}
          isProcessing={isProcessing || hasRunningResearch}
          answerBondTicks={holocronAnswerBondTicks}
          querySignature={holocronQuerySignature(holocronLiveQuery)}
          draftQuery={holocronLiveQuery}
          livePulses={livePulses}
        />

        <Toaster position="top-center" />

        <SourceWeightsDialog
          open={isSettingsOpen}
          onOpenChange={setIsSettingsOpen}
          sourceWeights={effectiveSourceWeights}
          onSourceWeightsChange={(weights) => setSourceWeights(weights)}
          legacySparkMode={legacySparkMode}
          traskApiKey={traskApiKey || ''}
          onTraskApiKeyChange={(value) => setTraskApiKey(value)}
        />

        <KeyboardShortcutsDialog
          open={isShortcutsOpen}
          onOpenChange={setIsShortcutsOpen}
        />

        <PromptsDialog
          open={isPromptsOpen}
          onOpenChange={setIsPromptsOpen}
        />

        {(!isMobileViewport || !sidebarCollapsed) && (
          <div
            ref={isMobileViewport ? mobileSidebarRef : undefined}
            className={isMobileViewport ? 'absolute inset-y-0 left-0 z-30 min-h-0 shadow-2xl shadow-black/45' : 'relative flex-shrink-0 min-h-0'}
            role={isMobileViewport ? 'dialog' : undefined}
            aria-modal={isMobileViewport ? true : undefined}
            aria-label={isMobileViewport ? 'Conversation history' : undefined}
          >
            <ConversationSidebar
              conversations={conversations || []}
              activeConversationId={activeConversationId || null}
              onSelectConversation={handleSelectConversation}
              onCreateConversation={handleCreateConversation}
              disableCreateConversation={isProcessing}
              onDeleteConversation={handleDeleteConversation}
              onRenameConversation={handleRenameConversation}
              sourceWeights={effectiveSourceWeights}
              onImport={handleImportConversations}
              searchInputRef={searchInputRef}
              width={isMobileViewport ? 320 : clampSidebarWidth(sidebarWidth)}
              collapsed={!isMobileViewport && sidebarCollapsed}
              onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
            />
            {!isMobileViewport && !sidebarCollapsed && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize history sidebar"
                onMouseDown={handleSidebarResizeStart}
                className="absolute top-0 -right-1 h-full w-2 cursor-col-resize z-20 hidden md:block"
              />
            )}
          </div>
        )}

        <div className="flex-1 flex flex-col min-h-0 relative z-10 isolate bg-background/42 dark:bg-background/32 shadow-[inset_0_0_80px_oklch(0.98_0.02_95_/_0.06)] dark:shadow-[inset_0_0_100px_oklch(0.12_0.04_285_/_0.35)] border-l border-primary/15">
          <header className="border-b border-primary/30 bg-card/40 px-4 md:px-6 py-4 flex items-center justify-between gap-3 shadow-lg shadow-primary/10">
            <div className="flex items-center gap-3">
              <Button
                ref={mobileSidebarToggleButtonRef}
                variant="ghost"
                size="icon"
                onClick={() => setSidebarCollapsed((current) => !current)}
                className="md:hidden text-primary hover:text-accent hover:bg-primary/10 transition-all"
                aria-label={sidebarCollapsed ? 'Open history sidebar' : 'Close history sidebar'}
                title={sidebarCollapsed ? 'Open history' : 'Close history'}
              >
                <List size={20} weight="bold" />
              </Button>
              <HolocronGlyph variant="header" />
              <h1 className="font-bold text-[22px] md:text-[28px] tracking-wide text-accent glow-text">
                HOLOCRON ARCHIVE
              </h1>
            </div>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsPromptsOpen(true)}
                className="text-primary hover:text-accent hover:bg-primary/10 transition-all"
                aria-label="Edit AI prompts"
                title="AI Protocols (Ctrl+Shift+P)"
              >
                <Code size={20} weight="bold" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsShortcutsOpen(true)}
                className="text-primary hover:text-accent hover:bg-primary/10 transition-all"
                aria-label="Show keyboard shortcuts"
                title="Commands (Ctrl+/)"
              >
                <Keyboard size={20} weight="bold" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSettingsOpen(true)}
                className="text-primary hover:text-accent hover:bg-primary/10 transition-all"
                aria-label="Open settings"
                title="Data Source Configuration"
              >
                <Sliders size={20} weight="bold" />
              </Button>
            </div>
          </header>

          <div className="flex-1 flex flex-col min-h-0">
            <div
              className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 overscroll-contain"
              ref={scrollRef}
              onScroll={updateScrollStickiness}
              data-ui="chat-scroll-container"
            >
              <div className="mx-auto w-full max-w-7xl pt-6 pb-32 md:pb-40 px-4 md:px-6 lg:px-8">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center min-h-[min(52vh,420px)] px-6 py-10 text-center relative z-[1]">
                    <h2 className="text-xl font-semibold text-accent mb-3 font-totj-serif">
                      Access Knowledge Repository
                    </h2>
                    <p className="text-sm text-muted-foreground max-w-md mb-6 leading-relaxed">
                      Ask a question below. Answers use Trask research when the API is available (run{' '}
                      <code className="text-xs rounded bg-muted px-1 py-0.5">trask-http-server</code> on port{' '}
                      <code className="text-xs rounded bg-muted px-1 py-0.5">4010</code> or open Holocron from the Discord bot link).
                    </p>
                    {starterSuggestions.length > 0 ? (
                      <div className="flex flex-col gap-2 items-center max-w-lg">
                        <p className="text-xs text-muted-foreground">Continue from your recent questions</p>
                        <div className="flex flex-wrap gap-2 justify-center">
                          {starterSuggestions.map((suggestion) => (
                            <Button
                              key={suggestion}
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={queryInputLocked || !activeConversationId}
                              onClick={() => void submitQuestion(suggestion)}
                              className="text-xs border-primary/40 text-primary hover:bg-primary/20 hover:text-accent hover:border-accent/60 transition-all max-w-[min(100%,320px)] text-left whitespace-normal h-auto py-2 leading-snug"
                            >
                              {suggestion}
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground max-w-md">
                        Type a question below to start. Later visits will show shortcuts here based on questions you asked in other threads.
                      </p>
                    )}
                  </div>
                )}

                <div
                  className="space-y-0"
                  role="log"
                  aria-live="polite"
                  aria-relevant="additions text"
                  aria-label="Holocron conversation messages"
                >
                  {messages.map((message) => (
                    <Message
                      key={message.id}
                      message={message}
                      onToggleExpand={handleToggleExpand}
                    />
                  ))}
                </div>

                {activeAgents.length > 0 && <AgentPanel agents={activeAgents} queryType={currentQueryType} />}
              </div>
            </div>

            {showJumpToLatest && (
              <div className="pointer-events-none absolute bottom-28 right-4 md:bottom-32 md:right-6 z-20" data-ui="jump-latest-container">
                <Button
                  type="button"
                  size="sm"
                  className="pointer-events-auto bg-primary/95 hover:bg-accent text-primary-foreground shadow-lg shadow-primary/35"
                  onClick={jumpToLatest}
                  aria-label="Jump to latest message"
                  title="Jump to latest"
                  data-ui="jump-latest-button"
                >
                  <ArrowDown size={16} weight="bold" className="mr-1" />
                  Latest
                </Button>
              </div>
            )}

            <div className="flex-shrink-0 border-t border-primary/30 bg-card/70 backdrop-blur-md p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:p-4 shadow-[0_-4px_24px_0_rgba(0,0,0,0.35)]">
              <form onSubmit={handleSubmit} className="max-w-7xl mx-auto w-full px-4 md:px-6 lg:px-8">
                <div className="flex gap-2">
                  <Input
                    ref={inputRef}
                    id="question-input"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={activeConversationId ? (hasRunningResearch ? 'Send now to replace current research…' : 'Ask the Holocron anything…') : 'Preparing thread…'}
                    disabled={queryInputLocked || !activeConversationId}
                    className="flex-1 text-[15px] h-11 md:h-12 px-4 bg-background/85 border-primary/50 text-foreground placeholder:text-muted-foreground focus-visible:border-accent focus-visible:ring-accent/40"
                    aria-label="Question input"
                  />
                  <Button
                    type="submit"
                    disabled={!input.trim() || queryInputLocked || !activeConversationId}
                    size="lg"
                    className="h-11 md:h-12 px-4 md:px-6 bg-primary hover:bg-accent shadow-lg shadow-primary/30 hover:shadow-accent/30 transition-all"
                    aria-label={hasRunningResearch ? 'Send now and cancel current research' : 'Submit question'}
                    title={hasRunningResearch ? 'Send now and cancel current research' : 'Submit question'}
                  >
                    {isProcessing ? (
                      <span className="animate-spin">⟳</span>
                    ) : (
                      <ArrowRight size={20} weight="bold" />
                    )}
                  </Button>
                </div>
                <div className="mt-2 flex justify-center">
                  <HolocronModelPicker
                    value={normalizeTraskModelSelection(selectedTraskModel, effectiveTraskModelOptions)}
                    options={effectiveTraskModelOptions}
                    onValueChange={(value) => setSelectedTraskModel(normalizeTraskModelSelection(value, effectiveTraskModelOptions))}
                    disabled={queryInputLocked || !activeConversationId}
                  />
                </div>
              </form>
            </div>
          </div>
        </div>

        {isMobileViewport && !sidebarCollapsed && (
          <button
            type="button"
            aria-label="Close history sidebar overlay"
            className="absolute inset-0 z-20 bg-black/45 md:hidden"
            onClick={() => setSidebarCollapsed(true)}
          />
        )}
      </div>
    </div>
  )
}

export default App
