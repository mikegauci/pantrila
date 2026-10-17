"use client"

import { Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ago } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ChatThreadSummary } from "@/lib/types"

/** The person's saved chats, most recently used first. */
export function ChatThreads({
  threads, current, disabled, onSelect, onDelete,
}: {
  threads: ChatThreadSummary[] | undefined
  current: number | null
  disabled?: boolean
  onSelect: (id: number) => void
  onDelete: (thread: ChatThreadSummary) => void
}) {
  if (!threads?.length) {
    return <p className="px-3 py-2 text-[13px] text-muted-foreground">Your chats appear here.</p>
  }
  return (
    <ul className="grid gap-1">
      {threads.map((t) => {
        const active = t.id === current
        return (
          <li key={t.id}
              className={cn("group flex items-center rounded-xl", active ? "bg-primary-soft" : "hover:bg-surface-muted")}>
            <button
              type="button"
              disabled={disabled}
              aria-current={active ? "true" : undefined}
              onClick={() => onSelect(t.id)}
              className="min-w-0 flex-1 px-3 py-2 text-left disabled:opacity-60"
            >
              <span className={cn("block truncate text-[13px] font-medium", active && "text-primary-text")}>{t.title}</span>
              <span className="block text-[11px] text-muted-foreground">{ago(t.updated_at)}</span>
            </button>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`Delete “${t.title}”`}
              onClick={() => onDelete(t)}
              className="mr-1 shrink-0 text-muted-foreground md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
            >
              <Trash2 />
            </Button>
          </li>
        )
      })}
    </ul>
  )
}
