/** Resolve a public asset path for GitHub Pages base paths (e.g. `/community-bots/qa-webui/`). */
export function holocronAssetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL ?? '/'
  const normalized = relativePath.replace(/^\//, '')
  const prefix = base.endsWith('/') ? base : `${base}/`
  return `${prefix}${normalized}`
}
