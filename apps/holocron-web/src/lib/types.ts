export type MessageRole = 'user' | 'assistant' | 'system'

export type QueryType = 'modding' | 'technical' | 'lore' | 'general'

export type MessageResearchDiagValue = string | number | boolean

export interface MessageResearchStep {
  id: string
  at: number
  phase: string
  detail: string
  sources?: Array<{ id: string; name: string; url: string }>
  diag?: Record<string, MessageResearchDiagValue>
  urls?: string[]
}

export interface Message {
  id: string
  role: MessageRole
  content: string
  expandedContent?: string
  sources?: Source[]
  relatedSources?: Source[]
  timestamp: number
  isExpanded?: boolean
  agentResults?: AgentResult[]
  isAgentPanelExpanded?: boolean
  queryType?: QueryType
  researchStatus?: 'pending' | 'complete' | 'failed'
  researchSteps?: MessageResearchStep[]
  groundingStatus?: 'grounded' | 'partial' | 'failed'
  consultedSourceCount?: number
}

export interface Source {
  name: string
  url: string
  confidence: number
}

export interface AgentResult {
  agentName: string
  source: string
  snippet: string
  confidence: number
  status: 'retrieving' | 'complete' | 'failed'
  retrievedContent?: string
}

export interface SourceWeight {
  name: string
  url: string
  weight: number
  enabled: boolean
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  topics?: string[]
}

export type DateFilter = 'all' | 'today' | 'week' | 'month' | 'custom'

export interface ConversationFilters {
  searchQuery: string
  dateFilter: DateFilter
  customDateRange?: { start: number; end: number }
  selectedTopics: string[]
}

export interface ScrapedContent {
  url: string
  title: string
  content: string
  snippets: string[]
  relevanceScore: number
}

export const DEFAULT_SOURCE_WEIGHTS: SourceWeight[] = [
  { name: 'LucasForums Archive', url: 'https://lucasforumsarchive.org', weight: 1.0, enabled: true },
  { name: 'Deadly Stream', url: 'https://deadlystream.com', weight: 1.0, enabled: true },
  { name: 'KOTOR Neocities', url: 'https://kotor.neocities.org', weight: 1.0, enabled: true },
  { name: 'PyKotor Wiki', url: 'https://github.com/NickHugi/PyKotor/wiki', weight: 1.0, enabled: true },
  { name: 'GitHub KOTOR Projects', url: 'https://github.com', weight: 1.15, enabled: true },
  { name: 'Wikipedia — Star Wars KOTOR', url: 'https://en.wikipedia.org/wiki/Star_Wars:_Knights_of_the_Old_Republic', weight: 0.8, enabled: true },
  { name: 'StrategyWiki KOTOR', url: 'https://strategywiki.org/wiki/Star_Wars:_Knights_of_the_Old_Republic', weight: 0.8, enabled: true },
  { name: 'PCGamingWiki (reference only)', url: 'https://www.pcgamingwiki.com', weight: 0.75, enabled: false }
]

export function mergeSourceWeights(weights: SourceWeight[] | null | undefined): SourceWeight[] {
  if (!Array.isArray(weights)) return DEFAULT_SOURCE_WEIGHTS
  const byUrl = new Map(weights.map((source) => [source.url.replace(/\/+$/, '').toLowerCase(), source]))
  return DEFAULT_SOURCE_WEIGHTS.map((source) => {
    const existing = byUrl.get(source.url.replace(/\/+$/, '').toLowerCase())
    return existing
      ? {
          ...source,
          weight: Number.isFinite(existing.weight) ? existing.weight : source.weight,
          enabled: existing.enabled !== false,
        }
      : source
  })
}

const MESSAGE_ROLES: readonly MessageRole[] = ['user', 'assistant', 'system']

export function isMessage(value: unknown): value is Message {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const o = value as Record<string, unknown>
  return (
    typeof o.id === 'string'
    && typeof o.role === 'string'
    && MESSAGE_ROLES.includes(o.role as MessageRole)
    && typeof o.content === 'string'
    && typeof o.timestamp === 'number'
    && Number.isFinite(o.timestamp)
  )
}

export function isMessageArray(value: unknown): value is Message[] {
  return Array.isArray(value) && value.every(isMessage)
}
