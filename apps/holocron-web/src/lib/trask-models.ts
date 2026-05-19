export const TRASK_MODEL_AUTO = 'auto'

export type TraskModelOption = {
  id: string
  label: string
  provider: string
  recommended?: boolean
}

const AUTO_TRASK_MODEL_OPTION: TraskModelOption = {
  id: TRASK_MODEL_AUTO,
  label: 'Auto',
  provider: 'Trask web research',
  recommended: true,
}

export const TRASK_MODEL_OPTIONS: readonly TraskModelOption[] = [AUTO_TRASK_MODEL_OPTION]

const MODEL_ID_RE = /^[a-z0-9][a-z0-9._:/@+-]{0,159}$/iu

export function mergeTraskModelOptions(dynamicOptions: readonly TraskModelOption[]): readonly TraskModelOption[] {
  const seen = new Set<string>()
  const merged: TraskModelOption[] = []
  for (const option of [AUTO_TRASK_MODEL_OPTION, ...dynamicOptions]) {
    const id = option.id.trim()
    if (!id || seen.has(id) || !MODEL_ID_RE.test(id)) continue
    seen.add(id)
    merged.push({
      id,
      label: option.label.trim() || id,
      provider: option.provider.trim() || 'Trask web research',
      ...(option.recommended ? { recommended: true } : {}),
    })
  }
  return merged
}

export function normalizeTraskModelSelection(
  value: string | null | undefined,
  options: readonly TraskModelOption[] = TRASK_MODEL_OPTIONS,
): string {
  const id = value?.trim()
  return id && MODEL_ID_RE.test(id) && options.some((option) => option.id === id) ? id : TRASK_MODEL_AUTO
}

export function modelPayloadValue(value: string | null | undefined): string | undefined {
  const normalized = value?.trim() || TRASK_MODEL_AUTO
  return normalized === TRASK_MODEL_AUTO ? undefined : normalized
}

export function traskModelLabel(
  value: string | null | undefined,
  options: readonly TraskModelOption[] = TRASK_MODEL_OPTIONS,
): string {
  const normalized = normalizeTraskModelSelection(value, options)
  return options.find((option) => option.id === normalized)?.label ?? 'Auto'
}
