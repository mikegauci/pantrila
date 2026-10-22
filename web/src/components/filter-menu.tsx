"use client"

import { Popover } from "@base-ui/react/popover"
import { Check, ChevronDown } from "lucide-react"
import { useState, useSyncExternalStore } from "react"

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

const DESKTOP = "(min-width: 768px)"

function useDesktop() {
  return useSyncExternalStore(
    (notify) => {
      const media = window.matchMedia(DESKTOP)
      media.addEventListener("change", notify)
      return () => media.removeEventListener("change", notify)
    },
    () => window.matchMedia(DESKTOP).matches,
    () => true,
  )
}

type Props<T extends string> = {
  name: string
  options: { value: T; label: string }[]
  selected: T[]
  onChange: (next: T[]) => void
  /** Choosing an option replaces the last one; choosing it again clears the filter. */
  single?: boolean
}

/** A filter as one button showing its choice. Opens a popover on desktop and a bottom sheet on phones. */
export function FilterMenu<T extends string>({ name, options, selected, onChange, single = false }: Props<T>) {
  const [open, setOpen] = useState(false)
  const desktop = useDesktop()
  const picked = options.filter((o) => selected.includes(o.value)).map((o) => o.label)
  const summary = picked.length <= 2 ? picked.join(", ") : `${picked.length} selected`

  function pick(value: T) {
    if (single) return onChange(selected.includes(value) ? [] : [value])
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  const trigger = (
    <>
      {name}
      {picked.length > 0 && <span className="font-semibold">: {summary}</span>}
      <ChevronDown className="size-3.5 opacity-60" aria-hidden />
    </>
  )
  const triggerClass = cn(
    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 whitespace-nowrap text-[13px] font-medium transition-colors duration-150",
    picked.length > 0 ? "border-primary bg-primary-soft text-primary-text" : "bg-surface text-muted-foreground hover:text-foreground",
  )

  const list = (
    <div role={single ? "radiogroup" : "group"} aria-label={name} className="grid max-h-[min(22rem,70vh)] gap-0.5 overflow-y-auto">
      {options.map((o) => {
        const on = selected.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            role={single ? "radio" : "checkbox"}
            aria-checked={on}
            onClick={() => pick(o.value)}
            className="flex h-10 items-center justify-between gap-6 rounded-lg px-3 text-left text-[14px] hover:bg-muted sm:h-9"
          >
            {o.label}
            {on && <Check className="size-4 text-primary-text" aria-hidden />}
          </button>
        )
      })}
      {picked.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([])}
          className="mt-1 h-9 rounded-lg px-3 text-left text-[13px] text-muted-foreground hover:bg-muted"
        >
          Clear {name.toLowerCase()}
        </button>
      )}
    </div>
  )

  if (desktop) {
    return (
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger className={triggerClass}>{trigger}</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-50">
            <Popover.Popup className="min-w-48 rounded-xl border bg-popover p-1.5 text-popover-foreground shadow-lg outline-none">
              {list}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    )
  }

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger className={triggerClass}>{trigger}</SheetTrigger>
      <SheetContent side="bottom" className="rounded-t-2xl p-5">
        <SheetTitle className="text-[15px] font-semibold">{name}</SheetTitle>
        {list}
      </SheetContent>
    </Sheet>
  )
}
