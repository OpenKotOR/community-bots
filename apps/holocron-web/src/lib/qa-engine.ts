import type { QueryType } from './types'

export async function classifyQueryType(query: string): Promise<QueryType> {
  const lowerQuery = query.toLowerCase()

  const modPatterns = ['mod', 'install', 'patch', 'tslrcm', 'download', 'compatibility', 'texture', 'override']
  const lorePatterns = ['story', 'lore', 'character', 'plot', 'revan', 'sith', 'jedi', 'planet', 'who is', 'what happened']
  const technicalPatterns = ['error', 'crash', 'bug', 'fix', 'issue', 'problem', 'not working', 'help', 'troubleshoot']
  const generalPatterns = ['what is', 'how to', 'best', 'recommend', 'guide', 'tutorial', 'where']

  if (modPatterns.some((pattern) => lowerQuery.includes(pattern))) {
    return 'modding'
  }
  if (technicalPatterns.some((pattern) => lowerQuery.includes(pattern))) {
    return 'technical'
  }
  if (lorePatterns.some((pattern) => lowerQuery.includes(pattern))) {
    return 'lore'
  }
  if (generalPatterns.some((pattern) => lowerQuery.includes(pattern))) {
    return 'general'
  }

  return 'general'
}
