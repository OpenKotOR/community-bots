import type { Conversation } from '@/lib/types'

const MIN_CHARS = 14
const MAX_CHIPS = 5

/**
 * Prior user questions from other threads (by recency), de-duplicated case-insensitively.
 * Used for empty-state starter chips so they reflect real history, not static copy.
 */
export function priorUserQuestionsFromOtherThreads(
  conversations: Conversation[] | undefined,
  excludeConversationId: string | null,
  limit = MAX_CHIPS,
): string[] {
  const list = conversations ?? []
  const seen = new Set<string>()
  const scored: { text: string; t: number }[] = []

  for (const conv of list) {
    if (excludeConversationId && conv.id === excludeConversationId) continue
    for (const m of conv.messages) {
      if (m.role !== 'user') continue
      const text = m.content.trim().replace(/\s+/g, ' ')
      if (text.length < MIN_CHARS) continue
      const key = text.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      scored.push({ text, t: m.timestamp })
    }
  }

  scored.sort((a, b) => b.t - a.t)
  const cap = Math.max(1, Math.min(25, limit))
  return scored.slice(0, cap).map((s) => s.text)
}
