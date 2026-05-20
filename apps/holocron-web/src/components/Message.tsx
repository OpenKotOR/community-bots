import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { Message as MessageType, MessageResearchStep, Source } from '@/lib/types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CaretDown, CaretUp, Link as LinkIcon, Copy, Check, Clock, MagnifyingGlass, CheckCircle, XCircle, ListDashes, Download, Database } from '@phosphor-icons/react'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { toast } from 'sonner'

interface MessageProps {
  message: MessageType
  onToggleExpand: (id: string) => void
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.8) {
    return 'bg-accent/20 text-accent border-accent/40 shadow-[0_0_8px_-2px] shadow-accent/30'
  } else if (confidence >= 0.65) {
    return 'bg-primary/20 text-primary border-primary/40 shadow-[0_0_6px_-2px] shadow-primary/30'
  } else if (confidence >= 0.4) {
    return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40 shadow-[0_0_6px_-2px] shadow-yellow-500/30'
  } else {
    return 'bg-destructive/20 text-destructive border-destructive/40 shadow-[0_0_6px_-2px] shadow-destructive/30'
  }
}

function researchPhaseLabel(phaseRaw: string): string {
  const phase = phaseRaw.trim().toLowerCase()
  switch (phase) {
    case 'queued':
      return 'Queued'
    case 'dispatch':
      return 'Dispatching'
    case 'stream':
      return 'Streaming'
    case 'gather':
      return 'Gathering'
    case 'report':
      return 'Analyzing'
    case 'sources':
      return 'Verifying sources'
    case 'compose':
      return 'Composing'
    case 'retry':
      return 'Retrying'
    default:
      return phase ? phase[0]!.toUpperCase() + phase.slice(1) : 'Processing'
  }
}

function formatDiagValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

function ResearchStepDiagnostics({ step }: { step: MessageResearchStep }) {
  const diagEntries = step.diag ? Object.entries(step.diag) : []
  const urls = step.urls ?? []
  if (diagEntries.length === 0 && urls.length === 0 && (!step.sources || step.sources.length === 0)) {
    return null
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      transition={{ duration: 0.2 }}
      className="mt-1 space-y-1"
    >
      {diagEntries.length > 0 && (
        <dl className="grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-2 gap-y-0.5 rounded border border-border/40 bg-muted/30 px-1.5 py-1 font-mono text-xs leading-snug text-muted-foreground">
          {diagEntries.map(([key, value]) => (
            <div key={key} className="contents">
              <dt className="truncate text-foreground/70" title={key}>
                {key}
              </dt>
              <dd className="break-all text-foreground/85">{formatDiagValue(value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {urls.length > 0 && (
        <ul className="max-h-36 space-y-0.5 overflow-y-auto overscroll-contain rounded border border-border/40 bg-background/40 px-1.5 py-1">
          {urls.map((url) => (
            <li key={url} className="truncate font-mono text-xs leading-snug">
              {url.startsWith('http') ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:text-accent hover:underline"
                  title={url}
                  onClick={(event) => event.stopPropagation()}
                >
                  {url}
                </a>
              ) : (
                <span title={url}>{url}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {step.sources && step.sources.length > 0 && (
        <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
          {step.sources.map((source) => (
            <li key={`${source.id}:${source.url}`} className="truncate" title={source.url}>
              <span className="text-foreground/75">{source.name}</span>
              <span className="text-muted-foreground/80"> · </span>
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
                onClick={(event) => event.stopPropagation()}
              >
                {source.url}
              </a>
            </li>
          ))}
        </ul>
      )}
    </motion.div>
  )
}

function timelineStepKey(step: MessageResearchStep, idx: number): string {
  return step.id || `${step.phase}:${step.at}:${idx}`
}

function failureReasonFromResearchSteps(steps: readonly MessageResearchStep[]): string | null {
  const lastCompose = [...steps].reverse().find((step) => step.phase === 'compose')
  const detail = lastCompose?.detail?.trim()
  if (detail && !/^done ·/i.test(detail)) {
    if (/timed out|failed|gather timed out/i.test(detail)) {
      return detail.slice(0, 240)
    }
  }
  const diag = lastCompose?.diag
  if (diag) {
    const error = diag.error
    if (typeof error === 'string' && error.trim()) {
      return error.trim().slice(0, 240)
    }
    const grounding = diag.grounding_status
    if (typeof grounding === 'string' && grounding === 'failed') {
      const cited = diag.cited_sources
      if (typeof cited === 'number') {
        return `Insufficient grounded citations (${cited} cited).`
      }
      return 'Grounding failed — not enough on-topic citations.'
    }
  }
  return null
}

interface DisplaySource extends Source {
  index: number
  hostname: string
}

interface AnswerPresentation {
  answerText: string
  hasAnswerText: boolean
  isSourceOnly: boolean
  sources: DisplaySource[]
  sourceByIndex: Map<number, DisplaySource>
}

const SOURCE_HEADING_PATTERN = /^\s*sources\s*:?\s*$/i
const CITATION_PATTERN = /\[(\d{1,3})\]/g
const URL_PATTERN = /[a-z][a-z0-9+.-]*:\/\/[^\s)\]]+/gi

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

function sourceKey(source: Pick<Source, 'name' | 'url'>): string {
  const url = source.url?.trim().toLowerCase()
  if (url) return `url:${url}`
  return `name:${source.name.trim().toLowerCase()}`
}

function stripSourceNoise(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1')
    .replace(URL_PATTERN, '')
    .replace(/[()[\]]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

function splitAnswerFromSourceSection(content: string): { answerText: string; sourceText: string } {
  const normalized = content.replace(/\r\n/g, '\n').trim()
  const lines = normalized.split('\n')
  const sourceHeadingIndex = lines.findIndex((line) => SOURCE_HEADING_PATTERN.test(line))

  if (sourceHeadingIndex === -1) {
    return { answerText: normalized, sourceText: '' }
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

    const citationMatch = line.match(/^\[(\d{1,3})\]\s*(.*)$/)
    if (citationMatch) {
      entries.push({ index: Number(citationMatch[1]), body: [citationMatch[2] ?? ''] })
      continue
    }

    const numberedMatch = line.match(/^(\d{1,3})\.\s+(.*)$/)
    if (numberedMatch) {
      entries.push({ index: Number(numberedMatch[1]), body: [numberedMatch[2] ?? ''] })
      continue
    }

    const lastEntry = entries.length > 0 ? entries[entries.length - 1] : undefined
    lastEntry?.body.push(line)
  }

  return entries
    .map((entry) => {
      const body = entry.body.join(' ').trim()
      const urls = body.match(URL_PATTERN) ?? []
      const url = cleanUrl(urls[0] ?? '')
      const name = stripSourceNoise(body) || (url ? sourceHostname(url) : `Source ${entry.index}`)

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

function buildAnswerPresentation(content: string, explicitSources: Source[] = []): AnswerPresentation {
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

function MessageView({ message, onToggleExpand }: MessageProps) {
  const prefersReducedMotion = useReducedMotion()
  const [isCopied, setIsCopied] = useState(false)
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false)
  const [isResearchPanelOpen, setIsResearchPanelOpen] = useState(false)
  const [isFailedSourcesOpen, setIsFailedSourcesOpen] = useState(false)
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'
  const hasResearchTimeline = !isUser && Boolean(message.researchSteps && message.researchSteps.length > 0)
  const sortedResearchSteps = useMemo(() => {
    const steps = message.researchSteps ?? []
    return [...steps].sort((a, b) => a.at - b.at)
  }, [message.researchSteps])
  const visibleContent = message.isExpanded && message.expandedContent
    ? message.expandedContent
    : message.content
  const hasDistinctExpandedContent = !isUser
    && Boolean(message.expandedContent?.trim())
    && message.expandedContent?.trim() !== message.content.trim()
  const answerPresentation = useMemo(
    () => buildAnswerPresentation(visibleContent, message.sources ?? []),
    [message.sources, visibleContent],
  )
  const relatedSources = useMemo(() => {
    const citedKeys = new Set(answerPresentation.sources.map((source) => sourceKey(source)))
    return (message.relatedSources ?? []).filter((source) => !citedKeys.has(sourceKey(source)))
  }, [answerPresentation.sources, message.relatedSources])
  const fallbackVisibleText = answerPresentation.isSourceOnly
    ? 'Trask returned source references, but no visible answer text. Review the sources below or try asking a narrower question.'
    : message.researchStatus === 'pending'
      ? 'Consulting the archives. The answer will appear here when the research completes.'
      : 'No visible answer text was returned for this message.'

  const toggleAgentDetail = (agentName: string) => {
    setExpandedAgents(prev => {
      const newSet = new Set(prev)
      if (newSet.has(agentName)) {
        newSet.delete(agentName)
      } else {
        newSet.add(agentName)
      }
      return newSet
    })
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const textToCopy = visibleContent.trim() || fallbackVisibleText

    try {
      await navigator.clipboard.writeText(textToCopy)
      setIsCopied(true)
      toast.success('Copied to clipboard')
      setTimeout(() => setIsCopied(false), 2000)
    } catch (err) {
      toast.error('Failed to copy')
    }
  }

  const handleExportAgentData = async (e: React.MouseEvent) => {
    e.stopPropagation()

    if (!message.agentResults || message.agentResults.length === 0) {
      toast.error('No agent data to export')
      return
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      messageTimestamp: new Date(message.timestamp).toISOString(),
      answer: message.content.trim() || fallbackVisibleText,
      expandedAnswer: message.expandedContent?.trim() || undefined,
      sources: answerPresentation.sources,
      relatedSources,
      agentResults: message.agentResults.map(agent => ({
        agentName: agent.agentName,
        source: agent.source,
        status: agent.status,
        confidence: agent.confidence,
        snippet: agent.snippet,
        retrievedContentLength: agent.retrievedContent?.length || 0,
        retrievedContent: agent.retrievedContent
      })),
      statistics: {
        totalAgents: message.agentResults.length,
        successfulAgents: message.agentResults.filter(a => a.status === 'complete').length,
        failedAgents: message.agentResults.filter(a => a.status === 'failed').length,
        averageConfidence: message.agentResults.reduce((sum, a) => sum + a.confidence, 0) / message.agentResults.length,
        highConfidenceSources: message.agentResults.filter(a => a.confidence > 0.65).length
      }
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `agent-retrieval-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast.success('Agent data exported')
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    })
  }

  const researchTraceOutcome = useMemo(() => {
    if (message.researchStatus === 'pending') return 'pending'
    if (message.researchStatus === 'failed' || message.groundingStatus === 'failed') return 'failed'
    if (message.groundingStatus === 'partial') return 'partial'
    return 'complete'
  }, [message.groundingStatus, message.researchStatus])

  const traceFailureReason = useMemo(
    () => failureReasonFromResearchSteps(sortedResearchSteps),
    [sortedResearchSteps],
  )

  const openedTraceAfterCompleteRef = useRef(false)

  const answerRegionA11y =
    message.researchStatus === 'pending'
      ? { 'aria-busy': true as const, 'aria-live': 'polite' as const }
      : !isUser && message.researchStatus !== 'pending'
        ? { 'aria-live': 'polite' as const }
        : {}

  useEffect(() => {
    if (!hasResearchTimeline) return
    if (message.researchStatus === 'pending') {
      setIsResearchPanelOpen(true)
      return
    }
    if (
      !openedTraceAfterCompleteRef.current
      && message.researchStatus !== 'pending'
      && sortedResearchSteps.length > 0
    ) {
      openedTraceAfterCompleteRef.current = true
      setIsResearchPanelOpen(true)
    }
  }, [hasResearchTimeline, message.researchStatus, sortedResearchSteps.length])

  if (isSystem) {
    return (
      <div
        className="flex justify-center mb-3"
        role="status"
        aria-live="polite"
      >
        <p className="text-muted-foreground text-sm">{message.content}</p>
      </div>
    )
  }

  const hasAgentResults = !isUser && message.agentResults && message.agentResults.length > 0
  const showLegacyAgentPanel = hasAgentResults && !hasResearchTimeline
  const successfulAgents = hasAgentResults ? (message.agentResults || []).filter(a => a.status === 'complete' && a.confidence > 0.65) : []
  const failedAgents = hasAgentResults ? (message.agentResults || []).filter(a => a.status === 'failed' || a.confidence <= 0.65) : []

  const renderResearchTimeline = () => {
    if (!hasResearchTimeline) {
      return null
    }

    return (
      <Card className="w-full max-w-4xl mx-auto gap-0 border-border/60 bg-muted/20 py-0 shadow-[0_8px_30px_-18px_rgba(0,0,0,0.55)] backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="px-2 py-1.5"
          aria-label="Thought process"
          role="region"
        >
          <Collapsible
            open={isResearchPanelOpen}
            onOpenChange={setIsResearchPanelOpen}
          >
            <CollapsibleTrigger
              className="flex min-h-7 w-full items-center justify-between rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45 group/trigger"
              aria-live={researchTraceOutcome === 'pending' ? 'polite' : undefined}
            >
              <div className="flex items-center gap-2 min-w-0">
                {researchTraceOutcome === 'pending' ? (
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
                    className="text-primary"
                  >
                    <MagnifyingGlass size={14} weight="bold" />
                  </motion.div>
                ) : researchTraceOutcome === 'failed' ? (
                  <XCircle size={14} weight="fill" className="text-destructive" />
                ) : researchTraceOutcome === 'partial' ? (
                  <ListDashes size={14} weight="bold" className="text-yellow-500" />
                ) : (
                  <CheckCircle size={14} weight="fill" className="text-accent" />
                )}
                <span className="text-xs font-medium">
                  {researchTraceOutcome === 'pending' ? 'Thinking' : 'Thought process'}
                </span>
                <Badge variant="secondary" className="h-5 px-1.5 text-xs">
                  {sortedResearchSteps.length} step{sortedResearchSteps.length === 1 ? '' : 's'}
                </Badge>
              </div>
              {isResearchPanelOpen ? (
                <CaretUp size={14} weight="bold" className="text-current" />
              ) : (
                <CaretDown size={14} weight="bold" className="text-current" />
              )}
            </CollapsibleTrigger>

            <CollapsibleContent className="overflow-hidden">
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, height: 'auto' }}
                exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0, height: 0 }}
                className="mt-1 max-h-[min(28rem,55vh)] space-y-1 overflow-y-auto overscroll-contain pr-0.5"
              >
                {sortedResearchSteps.map((step, idx) => {
                  const isLast = idx === sortedResearchSteps.length - 1
                  return (
                    <div key={timelineStepKey(step, idx)} className="relative pl-3.5">
                      {!isLast && (
                        <span className="absolute left-[5px] top-4 h-[calc(100%-2px)] w-px bg-border/70" aria-hidden />
                      )}
                      <span
                        className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ${
                          isLast && message.researchStatus === 'pending' ? 'bg-primary animate-pulse' : 'bg-accent/80'
                        }`}
                        aria-hidden
                      />
                      <div className="rounded border border-border/50 bg-background/50 px-1.5 py-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-foreground/90">
                            {researchPhaseLabel(step.phase)}
                          </p>
                          <span className="text-xs text-muted-foreground">{formatTime(step.at)}</span>
                        </div>
                        <p className="mt-0.5 break-words font-mono text-xs leading-snug text-muted-foreground">
                          {step.detail}
                        </p>
                        <ResearchStepDiagnostics step={step} />
                      </div>
                    </div>
                  )
                })}
              </motion.div>
            </CollapsibleContent>
          </Collapsible>
        </motion.div>
      </Card>
    )
  }

  const renderInlineCitations = (text: string) => {
    const nodes: React.ReactNode[] = []
    let lastIndex = 0

    for (const match of text.matchAll(CITATION_PATTERN)) {
      const fullMatch = match[0]
      const citationIndex = Number(match[1])
      const start = match.index ?? 0
      const source = answerPresentation.sourceByIndex.get(citationIndex)

      if (start > lastIndex) {
        nodes.push(text.slice(lastIndex, start))
      }

      if (source?.url) {
        nodes.push(
          <a
            key={`${citationIndex}:${start}`}
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="mx-0.5 inline-flex h-5 min-w-5 translate-y-[-1px] items-center justify-center rounded-full border border-primary/35 bg-primary/10 px-1.5 text-[11px] font-semibold leading-none text-primary hover:border-accent/60 hover:bg-accent/15 hover:text-accent transition-colors"
            title={source.name}
          >
            {citationIndex}
          </a>,
        )
      } else {
        nodes.push(
          <span
            key={`${citationIndex}:${start}`}
            className="mx-0.5 inline-flex h-5 min-w-5 translate-y-[-1px] items-center justify-center rounded-full border border-border bg-muted/40 px-1.5 text-[11px] font-semibold leading-none text-muted-foreground"
            title="Citation"
          >
            {citationIndex}
          </span>,
        )
      }

      lastIndex = start + fullMatch.length
    }

    if (lastIndex < text.length) {
      nodes.push(text.slice(lastIndex))
    }

    return nodes.length > 0 ? nodes : text
  }

  const renderProvenanceStrip = () => {
    if (isUser || message.researchStatus === 'pending') return null
    const cited = answerPresentation.sources.length
    const consulted = message.consultedSourceCount ?? (cited + relatedSources.length)
    const status =
      message.groundingStatus
      ?? (message.researchStatus === 'failed'
        ? 'failed'
        : cited >= 2
          ? 'grounded'
          : 'failed')
    return (
      <p
        className="mb-3 text-xs text-muted-foreground"
        aria-label={`Provenance: ${cited} cited sources, ${consulted} consulted, status ${status}`}
      >
        Cited: {cited} · Consulted: {consulted} · Status: {status}
      </p>
    )
  }

  const renderFailedBanner = () => {
    if (message.researchStatus !== 'failed' && message.groundingStatus !== 'failed') return null
    const reason = traceFailureReason
    return (
      <p
        className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        role="alert"
      >
        {reason
          ? reason
          : 'Research could not produce a fully grounded answer. Review sources or rephrase your question.'}
      </p>
    )
  }

  const renderPartialBanner = () => {
    if (message.groundingStatus !== 'partial') return null
    return (
      <p
        className="mb-3 rounded-md border border-yellow-500/50 bg-yellow-500/15 px-3 py-2 text-sm text-yellow-100"
        role="status"
      >
        Answer used limited grounded citations. Expand Thought process or rephrase for stronger sources.
      </p>
    )
  }

  const renderAnswerBody = () => {
    if (!answerPresentation.hasAnswerText) {
      return (
        <div
          className="min-w-0 flex-1 text-[15px] leading-7 text-foreground/95"
          aria-label="Answer"
          {...answerRegionA11y}
        >
          {renderFailedBanner()}
          {renderPartialBanner()}
          {renderProvenanceStrip()}
          <p className="rounded-md border border-primary/25 bg-background/55 px-3 py-2 text-sm leading-6 text-muted-foreground">
            {fallbackVisibleText}
          </p>
        </div>
      )
    }

    const blocks = answerPresentation.answerText
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)

    return (
      <div
        className="min-w-0 flex-1 space-y-4 text-[15px] leading-7 text-foreground/95"
        aria-label="Answer"
        {...answerRegionA11y}
      >
        {renderFailedBanner()}
        {renderPartialBanner()}
        {renderProvenanceStrip()}
        {blocks.length > 0 ? blocks.map((block, idx) => (
          <p key={`${idx}:${block.slice(0, 24)}`} className="whitespace-pre-wrap">
            {renderInlineCitations(block)}
          </p>
        )) : (
          <p className="whitespace-pre-wrap">{renderInlineCitations(answerPresentation.answerText)}</p>
        )}
      </div>
    )
  }

  const renderAttachedSources = () => {
    if (isUser || (answerPresentation.sources.length === 0 && relatedSources.length === 0)) {
      return null
    }

    return (
      <div className="mt-5 border-t border-border/50 pt-4" aria-label="Sources">
        {answerPresentation.sources.length > 0 && (
          <>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <LinkIcon size={14} weight="bold" className="text-primary" />
                Sources
              </div>
              <Badge variant="secondary" className="h-5 px-2 text-[10px]">
                {answerPresentation.sources.length}
              </Badge>
            </div>

            <div className="grid gap-2 sm:grid-cols-2" role="list">
              {answerPresentation.sources.map((source) => {
                const sourceContent = (
                  <>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/10 text-xs font-bold text-primary">
                      {source.index}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground/90">
                        {source.name}
                      </span>
                      {source.hostname && (
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {source.hostname}
                        </span>
                      )}
                    </span>
                    <LinkIcon size={14} weight="bold" className="shrink-0 text-muted-foreground transition-colors group-hover/source:text-accent" />
                  </>
                )

                if (!source.url) {
                  return (
                    <div
                      key={`${source.index}:${source.name}`}
                      className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
                      role="listitem"
                    >
                      {sourceContent}
                    </div>
                  )
                }

                return (
                  <a
                    key={`${source.index}:${source.url}`}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="group/source flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 hover:border-primary/45 hover:bg-primary/10 transition-colors"
                    role="listitem"
                    title={source.url}
                  >
                    {sourceContent}
                  </a>
                )
              })}
            </div>
          </>
        )}

        {relatedSources.length > 0 && (
          <div className={answerPresentation.sources.length > 0 ? 'mt-4' : ''}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Database size={14} weight="bold" className="text-current" />
                Retrieved archives
              </div>
              <Badge variant="outline" className="h-5 px-2 text-[10px]">
                {relatedSources.length}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-2" role="list">
              {relatedSources.map((source, idx) => (
                <a
                  key={`${source.url}-${idx}`}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex items-center gap-1"
                  role="listitem"
                >
                  <Badge
                    variant="outline"
                    className="text-xs border-border/60 text-muted-foreground hover:bg-muted/40 transition-colors"
                  >
                    <LinkIcon size={12} className="mr-1" />
                    {source.name}
                  </Badge>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <motion.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
      className={`w-full mb-4 group ${isUser ? 'flex justify-end' : 'flex justify-center'}`}
      role="article"
      aria-label={`${isUser ? 'User' : 'Assistant'} message`}
    >
      {isUser ? (
        <Card
          className={`w-full max-w-[85%] md:max-w-[70%] px-4 py-3 relative ${
            isUser
              ? 'bg-primary text-primary-foreground'
              : 'bg-card hover:bg-card/80 transition-colors'
          }`}
        >
            <div
            className={hasDistinctExpandedContent ? 'cursor-pointer' : ''}
            onClick={() => hasDistinctExpandedContent && onToggleExpand(message.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap flex-1">
                {visibleContent}
              </p>
              <div className="flex gap-1 flex-shrink-0">
                {hasAgentResults && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleExportAgentData}
                    className="h-6 w-6 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Export agent data"
                    title="Export agent retrieval data"
                  >
                    <Download size={14} weight="bold" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleCopy}
                  className={`h-6 w-6 transition-opacity ${
                    isUser
                      ? 'text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10'
                      : 'text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                  }`}
                  aria-label="Copy message"
                  title="Copy message"
                >
                  {isCopied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
                </Button>
              </div>
            </div>

            <div className={`flex items-center gap-1.5 mt-2 text-xs ${
              isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'
            }`}>
              <Clock size={12} weight="bold" />
              <span>{formatTime(message.timestamp)}</span>
              {hasAgentResults && (
                <Badge
                  variant="secondary"
                  className="ml-1.5 h-5 border border-accent/35 bg-background/70 px-1.5 text-[10px] font-medium text-foreground hover:bg-accent/20 transition-colors"
                  title="This message has exportable agent retrieval data"
                >
                  <Database size={10} weight="bold" className="mr-1" />
                  Data
                </Badge>
              )}
            </div>

            {hasDistinctExpandedContent && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleExpand(message.id)
                  }}
                  className="h-auto p-0 text-sm font-medium text-accent hover:bg-accent/10 hover:text-foreground focus-visible:ring-accent/45"
                  aria-label={message.isExpanded ? 'Show less' : 'Show more'}
                >
                  {message.isExpanded ? (
                    <>
                      <CaretUp className="mr-1" weight="bold" size={14} />
                      Show less
                    </>
                  ) : (
                    <>
                      <CaretDown className="mr-1" weight="bold" size={14} />
                      Show more
                    </>
                  )}
                </Button>
              </div>
            )}

            {!isUser && answerPresentation.sources.length > 0 && (
              <AnimatePresence>
                {message.isExpanded && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="mt-3 pt-3 border-t border-border/50"
                  >
                    <p className="text-xs text-muted-foreground mb-2 font-medium">Sources:</p>
                    <div className="flex flex-wrap gap-2" role="list">
                      {answerPresentation.sources.map((source, idx) => (
                        <a
                          key={idx}
                          href={source.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                          role="listitem"
                        >
                          <Badge
                            variant="outline"
                            className="text-xs hover:bg-accent/20 transition-colors"
                          >
                            <LinkIcon size={12} className="mr-1" />
                            {source.name}
                          </Badge>
                        </a>
                      ))}
                    </div>
                    {relatedSources.length > 0 && (
                      <div className="mt-3">
                        <p className="text-xs text-muted-foreground mb-2 font-medium">Retrieved archives:</p>
                        <div className="flex flex-wrap gap-2" role="list">
                          {relatedSources.map((source, idx) => (
                            <a
                              key={`${source.url}-${idx}`}
                              href={source.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                              role="listitem"
                            >
                              <Badge
                                variant="outline"
                                className="text-xs border-border/60 text-muted-foreground hover:bg-muted/40 transition-colors"
                              >
                                <LinkIcon size={12} className="mr-1" />
                                {source.name}
                              </Badge>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            )}
          </div>
        </Card>
      ) : (
        <div className="w-full max-w-6xl mx-auto flex flex-col gap-3">
          {renderResearchTimeline()}

          <Card
            className="w-full px-5 py-4 relative bg-card/85 hover:bg-card/90 transition-colors border-border/60 shadow-[0_12px_40px_-24px_rgba(0,0,0,0.65)]"
          >
            {showLegacyAgentPanel && (
              <div className="mb-3 pb-3 border-b border-border/50">
                <Collapsible
                  open={isAgentPanelOpen}
                  onOpenChange={setIsAgentPanelOpen}
                >
                  <CollapsibleTrigger className="flex items-center justify-between w-full group/trigger -mx-2 rounded px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45">
                    <div className="flex items-center gap-2">
                      <ListDashes size={14} weight="bold" className="text-current" />
                      <span className="text-xs font-medium">
                        {isAgentPanelOpen ? 'Hide' : 'Show'} retrieval details ({successfulAgents.length} source{successfulAgents.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                    {isAgentPanelOpen ? (
                      <CaretUp size={14} weight="bold" className="text-current" />
                    ) : (
                      <CaretDown size={14} weight="bold" className="text-current" />
                    )}
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="mt-2 space-y-1.5"
                    >
                      {successfulAgents.map((agent) => {
                        const isExpanded = expandedAgents.has(agent.agentName)
                        return (
                          <div key={agent.agentName}>
                            <button
                              onClick={() => toggleAgentDetail(agent.agentName)}
                              className="flex items-center justify-between w-full bg-muted/30 hover:bg-muted/50 px-2.5 py-2 rounded-md transition-colors group/agent"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <CheckCircle size={14} weight="fill" className="text-accent flex-shrink-0" />
                                <span className="text-xs font-medium text-foreground truncate">
                                  {agent.agentName}
                                </span>
                                <Badge
                                  variant="secondary"
                                  className={`text-[10px] px-1.5 py-0 h-auto ml-auto mr-1 font-semibold border ${getConfidenceColor(agent.confidence)}`}
                                >
                                  {Math.round(agent.confidence * 100)}%
                                </Badge>
                              </div>
                              {isExpanded ? (
                                <CaretUp size={12} weight="bold" className="text-muted-foreground flex-shrink-0" />
                              ) : (
                                <CaretDown size={12} weight="bold" className="text-muted-foreground flex-shrink-0" />
                              )}
                            </button>

                            {isExpanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                                className="ml-6 mt-1.5 text-xs text-muted-foreground bg-muted/20 px-2.5 py-2 rounded-md"
                              >
                                <p className="font-medium mb-1">Summary:</p>
                                <p className="leading-relaxed">{agent.snippet || 'No preview available'}</p>
                                {agent.retrievedContent && agent.retrievedContent.length > 150 && (
                                  <p className="text-[10px] mt-1.5 italic">
                                    Retrieved {agent.retrievedContent.length} characters of content
                                  </p>
                                )}
                              </motion.div>
                            )}
                          </div>
                        )
                      })}

                      {failedAgents.length > 0 && (
                        <Collapsible open={isFailedSourcesOpen} onOpenChange={setIsFailedSourcesOpen}>
                          <CollapsibleTrigger className="mt-2 flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45">
                            <span className="flex items-center gap-1.5">
                              <XCircle size={12} weight="bold" />
                              {failedAgents.length} source{failedAgents.length !== 1 ? 's' : ''} unavailable
                            </span>
                            {isFailedSourcesOpen ? (
                              <CaretUp size={12} weight="bold" />
                            ) : (
                              <CaretDown size={12} weight="bold" />
                            )}
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <div className="ml-5 mt-1 space-y-0.5 text-muted-foreground">
                              {failedAgents.map((agent) => (
                                <div key={agent.agentName} className="text-[10px]">
                                  {agent.agentName}
                                </div>
                              ))}
                            </div>
                          </CollapsibleContent>
                        </Collapsible>
                      )}
                    </motion.div>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            )}

            <div
              className={hasDistinctExpandedContent ? 'cursor-pointer' : ''}
              onClick={() => hasDistinctExpandedContent && onToggleExpand(message.id)}
            >
              <div className="flex items-start justify-between gap-2">
                {renderAnswerBody()}
                <div className="flex gap-1 flex-shrink-0">
                  {hasAgentResults && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleExportAgentData}
                      className="h-6 w-6 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Export agent data"
                      title="Export agent retrieval data"
                    >
                      <Download size={14} weight="bold" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopy}
                    className={`h-6 w-6 transition-opacity ${
                      isUser
                        ? 'text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/10'
                        : 'text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100'
                    }`}
                    aria-label="Copy message"
                    title="Copy message"
                  >
                    {isCopied ? <Check size={14} weight="bold" /> : <Copy size={14} weight="bold" />}
                  </Button>
                </div>
              </div>

              <div className={`flex items-center gap-1.5 mt-2 text-xs ${
                isUser ? 'text-primary-foreground/60' : 'text-muted-foreground'
              }`}>
                <Clock size={12} weight="bold" />
                <span>{formatTime(message.timestamp)}</span>
                {hasAgentResults && (
                  <Badge
                    variant="secondary"
                    className="ml-1.5 h-5 border border-accent/35 bg-background/70 px-1.5 text-[10px] font-medium text-foreground hover:bg-accent/20 transition-colors"
                    title="This message has exportable agent retrieval data"
                  >
                    <Database size={10} weight="bold" className="mr-1" />
                    Data
                  </Badge>
                )}
              </div>

              {hasDistinctExpandedContent && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      onToggleExpand(message.id)
                    }}
                    className="h-auto p-0 text-sm font-medium text-accent hover:bg-accent/10 hover:text-foreground focus-visible:ring-accent/45"
                    aria-label={message.isExpanded ? 'Show less' : 'Show more'}
                  >
                    {message.isExpanded ? (
                      <>
                        <CaretUp className="mr-1" weight="bold" size={14} />
                        Show less
                      </>
                    ) : (
                      <>
                        <CaretDown className="mr-1" weight="bold" size={14} />
                        Show more
                      </>
                    )}
                  </Button>
                </div>
              )}

              {renderAttachedSources()}
            </div>
          </Card>
        </div>
      )}
    </motion.div>
  )
}

export const Message = memo(MessageView)
Message.displayName = 'Message'
