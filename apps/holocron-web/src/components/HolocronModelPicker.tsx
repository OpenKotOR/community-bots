import { Lightning } from '@phosphor-icons/react'

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { TRASK_MODEL_OPTIONS, normalizeTraskModelSelection, type TraskModelOption } from '@/lib/trask-models'

type HolocronModelPickerProps = {
  value: string
  onValueChange: (value: string) => void
  options?: readonly TraskModelOption[]
  disabled?: boolean
}

export function HolocronModelPicker({ value, onValueChange, options = TRASK_MODEL_OPTIONS, disabled }: HolocronModelPickerProps) {
  const normalizedValue = normalizeTraskModelSelection(value, options)
  const selected = options.find((option) => option.id === normalizedValue) ?? options[0] ?? TRASK_MODEL_OPTIONS[0]

  return (
    <div className="flex items-center justify-center gap-2 text-[10px] uppercase tracking-wide text-muted-foreground">
      <span className="hidden sm:inline">Powered by</span>
      <Select value={normalizedValue} onValueChange={onValueChange} disabled={disabled}>
        <SelectTrigger
          size="sm"
          className="h-8 min-w-[176px] max-w-[min(74vw,260px)] justify-start border-primary/40 bg-background/85 text-xs normal-case tracking-normal shadow-primary/10 hover:border-accent/60"
          aria-label="Research model"
          title="Research model"
        >
          <Lightning size={14} weight="fill" className="text-accent" />
          <span className="min-w-0 truncate">{selected.label}</span>
        </SelectTrigger>
        <SelectContent className="max-h-[320px] min-w-[260px] border-primary/30 bg-popover/95 backdrop-blur-md">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id} className="py-2">
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium">{option.label}</span>
                    {option.recommended ? (
                      <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase text-accent-foreground">
                        Recommended
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[11px] text-muted-foreground">{option.provider}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}