import { useEffect, useMemo, useState } from 'react'
import { Message as MessageType, MessageResearchStep } from '@/lib/types'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { CaretDown, CaretUp, Link as LinkIcon, Copy, Check, Clock, MagnifyingGlass, CheckCircle, XCircle, ListDashes, Download, Database } from '@phosphor-icons/react'
import { motion, AnimatePresence } from 'framer-motion'
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

function timelineStepKey(step: MessageResearchStep, idx: number): string {
  return step.id || `${step.phase}:${step.at}:${idx}`
}

export function Message({ message, onToggleExpand }: MessageProps) {
  const [isCopied, setIsCopied] = useState(false)
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false)
  const [isResearchPanelOpen, setIsResearchPanelOpen] = useState(false)
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set())
  const isUser = message.role === 'user'
  const isSystem = message.role === 'system'

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
    const textToCopy = message.isExpanded && message.expandedContent 
      ? message.expandedContent 
      : message.content
    
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
      answer: message.content,
      expandedAnswer: message.expandedContent,
      sources: message.sources || [],
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

  const hasResearchTimeline = !isUser && Boolean(message.researchSteps && message.researchSteps.length > 0)
  const sortedResearchSteps = useMemo(() => {
    const steps = message.researchSteps ?? []
    return [...steps].sort((a, b) => a.at - b.at)
  }, [message.researchSteps])

  useEffect(() => {
    if (message.researchStatus === 'pending' && hasResearchTimeline) {
      setIsResearchPanelOpen(true)
    }
    if (message.researchStatus && message.researchStatus !== 'pending') {
      setIsResearchPanelOpen(false)
    }
  }, [hasResearchTimeline, message.researchStatus])

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

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3 group`}
      role="article"
      aria-label={`${isUser ? 'User' : 'Assistant'} message`}
    >
      <Card
        className={`px-4 py-3 max-w-[85%] md:max-w-[70%] relative ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-card hover:bg-card/80 transition-colors'
        }`}
      >
        {hasResearchTimeline && (
          <div className="mb-3 pb-2 border-b border-border/50">
            <Collapsible
              open={isResearchPanelOpen}
              onOpenChange={setIsResearchPanelOpen}
            >
              <CollapsibleTrigger className="flex min-h-8 items-center justify-between w-full group/trigger hover:bg-muted/50 -mx-2 px-2 py-1 rounded transition-colors">
                <div className="flex items-center gap-2 min-w-0">
                  {message.researchStatus === 'pending' ? (
                    <motion.div
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
                      className="text-primary"
                    >
                      <MagnifyingGlass size={14} weight="bold" />
                    </motion.div>
                  ) : (
                    <CheckCircle size={14} weight="fill" className="text-accent" />
                  )}
                  <span className="text-xs font-medium text-muted-foreground">
                    {message.researchStatus === 'pending' ? 'Thinking' : 'Thought process'}
                  </span>
                  <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                    {sortedResearchSteps.length} step{sortedResearchSteps.length === 1 ? '' : 's'}
                  </Badge>
                </div>
                {isResearchPanelOpen ? (
                  <CaretUp size={14} weight="bold" className="text-muted-foreground" />
                ) : (
                  <CaretDown size={14} weight="bold" className="text-muted-foreground" />
                )}
              </CollapsibleTrigger>

              <CollapsibleContent className="overflow-hidden">
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 max-h-72 space-y-2 overflow-y-auto overscroll-contain pr-1.5"
                >
                  {sortedResearchSteps.map((step, idx) => {
                    const isLast = idx === sortedResearchSteps.length - 1
                    return (
                      <div key={timelineStepKey(step, idx)} className="relative pl-4">
                        {!isLast && (
                          <span className="absolute left-[5px] top-4 h-[calc(100%-2px)] w-px bg-border/70" aria-hidden />
                        )}
                        <span
                          className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ${
                            isLast && message.researchStatus === 'pending' ? 'bg-primary animate-pulse' : 'bg-accent/80'
                          }`}
                          aria-hidden
                        />
                        <div className="rounded-md bg-muted/20 px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-semibold text-foreground/90 uppercase tracking-wide">
                              {researchPhaseLabel(step.phase)}
                            </p>
                            <span className="text-[10px] text-muted-foreground">{formatTime(step.at)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{step.detail}</p>
                          {step.sources && step.sources.length > 0 && (
                            <p className="text-[10px] text-muted-foreground/80 mt-1">
                              {step.sources.length} source{step.sources.length === 1 ? '' : 's'} touched
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </motion.div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {showLegacyAgentPanel && (
          <div className="mb-3 pb-3 border-b border-border/50">
            <Collapsible
              open={isAgentPanelOpen}
              onOpenChange={setIsAgentPanelOpen}
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full group/trigger hover:bg-muted/50 -mx-2 px-2 py-1.5 rounded transition-colors">
                <div className="flex items-center gap-2">
                  <ListDashes size={14} weight="bold" className="text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground">
                    {isAgentPanelOpen ? 'Hide' : 'Show'} retrieval details ({successfulAgents.length} source{successfulAgents.length !== 1 ? 's' : ''})
                  </span>
                </div>
                {isAgentPanelOpen ? (
                  <CaretUp size={14} weight="bold" className="text-muted-foreground" />
                ) : (
                  <CaretDown size={14} weight="bold" className="text-muted-foreground" />
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
                    <details className="text-xs text-muted-foreground/70 mt-2">
                      <summary className="cursor-pointer hover:text-muted-foreground flex items-center gap-1.5">
                        <XCircle size={12} weight="bold" />
                        {failedAgents.length} source{failedAgents.length !== 1 ? 's' : ''} unavailable
                      </summary>
                      <div className="ml-5 mt-1 space-y-0.5">
                        {failedAgents.map((agent) => (
                          <div key={agent.agentName} className="text-[10px]">
                            • {agent.agentName}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </motion.div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        <div
          className={!isUser && message.expandedContent ? 'cursor-pointer' : ''}
          onClick={() => !isUser && message.expandedContent && onToggleExpand(message.id)}
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-[15px] leading-relaxed whitespace-pre-wrap flex-1">
              {message.isExpanded && message.expandedContent
                ? message.expandedContent
                : message.content}
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
                    : 'text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100'
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
                className="ml-1.5 h-5 px-1.5 text-[10px] font-medium bg-accent/20 text-accent-foreground hover:bg-accent/30 transition-colors"
                title="This message has exportable agent retrieval data"
              >
                <Database size={10} weight="bold" className="mr-1" />
                Data
              </Badge>
            )}
          </div>

          {!isUser && message.expandedContent && (
            <div className="mt-3 pt-3 border-t border-border/50">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleExpand(message.id)
                }}
                className="h-auto p-0 text-accent-foreground hover:text-accent font-medium text-sm"
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

          {!isUser && message.sources && message.sources.length > 0 && (
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
                    {message.sources.map((source, idx) => (
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
                </motion.div>
              )}
            </AnimatePresence>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
