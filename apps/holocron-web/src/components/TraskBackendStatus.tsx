import { useEffect, useState } from 'react'
import { WarningCircle, ArrowsClockwise } from '@phosphor-icons/react'
import { traskApiOrigin, traskFetchHealth, type TraskHealthDto } from '@/lib/trask-api'

type StatusKind = 'loading' | 'ok' | 'degraded' | 'unreachable'

function classifyHealth(data: TraskHealthDto | null, fetchError: string | null): StatusKind {
  if (fetchError) return 'unreachable'
  if (!data?.ok) return 'degraded'
  if (data.upstreamReachable === false) return 'degraded'
  if (data.mode === 'proxy' && !data.upstream) return 'degraded'
  return 'ok'
}

export function TraskBackendStatus() {
  const origin = traskApiOrigin()
  const [health, setHealth] = useState<TraskHealthDto | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)

  const refresh = async () => {
    setFetchError(null)
    try {
      const next = await traskFetchHealth()
      setHealth(next)
      setCheckedAt(Date.now())
    } catch (err) {
      setHealth(null)
      setFetchError(err instanceof Error ? err.message : 'Health check failed.')
      setCheckedAt(Date.now())
    }
  }

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 45_000)
    return () => window.clearInterval(timer)
  }, [origin])

  if (!origin) return null

  const kind = classifyHealth(health, fetchError)
  if (kind === 'ok') return null

  const tone =
    kind === 'loading'
      ? 'border-border/50 bg-muted/30 text-muted-foreground'
      : kind === 'degraded'
        ? 'border-yellow-500/40 bg-yellow-500/10 text-yellow-100'
        : 'border-destructive/50 bg-destructive/10 text-destructive'

  const title =
    kind === 'loading'
      ? 'Checking Holocron research API…'
      : kind === 'degraded'
        ? 'Holocron research API is misconfigured'
        : 'Holocron research API is unreachable'

  const detail =
    fetchError
    ?? (health?.upstreamDetail
      ? health.upstreamDetail.replace(/\s+/g, ' ').trim().slice(0, 240)
      : health?.upstream
        ? `Proxy mode is active but the upstream Trask HTTP host is not healthy (${health.upstream}).`
        : 'The configured API origin did not return a healthy response.')

  return (
    <div
      className={`mx-4 md:mx-6 mt-3 rounded-md border px-3 py-2 text-sm ${tone}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        {kind === 'loading' ? (
          <ArrowsClockwise className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />
        ) : kind === 'degraded' ? (
          <WarningCircle className="mt-0.5 h-4 w-4 shrink-0" weight="fill" aria-hidden />
        ) : (
          <WarningCircle className="mt-0.5 h-4 w-4 shrink-0" weight="fill" aria-hidden />
        )}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{title}</p>
          <p className="text-xs opacity-90 break-words">{detail}</p>
          <p className="font-mono text-[11px] opacity-80 break-all">API: {origin}</p>
          {health?.upstream ? (
            <p className="font-mono text-[11px] opacity-80 break-all">Upstream: {health.upstream}</p>
          ) : null}
          {checkedAt ? (
            <p className="text-[11px] opacity-70">
              Last check: {new Date(checkedAt).toLocaleTimeString()}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="shrink-0 rounded border border-current/30 px-2 py-0.5 text-xs hover:bg-background/20"
          onClick={() => void refresh()}
        >
          Retry
        </button>
      </div>
    </div>
  )
}
