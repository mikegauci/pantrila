"use client"

import { CircleCheck, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"

import type { ImportStep } from "@/lib/import-jobs"
import { cn } from "@/lib/utils"

/** The steps of an import that already ran (ticked) and the one under way (spinning). A step
 * the import comes back to ("Matching ingredients" after the video) moves to the end. */
function rows(steps: ImportStep[]): { step: ImportStep; done: boolean }[] {
  if (!steps.length) return [{ step: { key: "start", label: "Starting the import" }, done: false }]
  const current = steps[steps.length - 1]
  const earlier = steps.slice(0, -1).filter((s, i, all) =>
    s.key !== current.key && all.findIndex((o) => o.key === s.key) === i)
  return [...earlier.map((step) => ({ step, done: true })), { step: current, done: false }]
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`

/**
 * What the import is doing, from the steps the server reports at each poll, with time spent
 * and, for posts, a rough estimate from this person's recent imports (never a promise).
 */
export function ImportProgress({ steps, estimatedSeconds = null }: {
  steps: ImportStep[]
  estimatedSeconds?: number | null
}) {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const remaining = estimatedSeconds === null ? null : Math.max(0, estimatedSeconds - elapsed)
  const list = rows(steps)
  return (
    <div className="grid gap-3 rounded-2xl bg-yellow-soft p-4 text-[13px]">
      <p role="status" className="sr-only">{list[list.length - 1].step.label}…</p>
      <ol aria-label="Import steps" className="grid gap-2">
        {list.map(({ step, done }) => (
          <li key={step.key} className={cn("flex items-center gap-2", done ? "text-muted-foreground" : "font-semibold")}>
            {done
              ? <CircleCheck className="size-4 shrink-0 text-primary" aria-label="Done" />
              : <Loader2 className="size-4 shrink-0 animate-spin text-[#b7860b]" aria-label="In progress" />}
            {step.label}{done ? "" : "…"}
          </li>
        ))}
      </ol>
      <div className="grid gap-0.5 border-t border-foreground/10 pt-2">
        <p className="tabular" aria-live="off">
          {remaining === null ? `${clock(elapsed)} so far`
            : remaining > 0 ? `About ${clock(remaining)} left`
            : "Taking longer than usual. Still working…"}
        </p>
        {remaining !== null && (
          <p className="text-[12px] text-muted-foreground">
            An estimate from your recent imports.
            <span className="md:hidden"> You can lock your phone; the import keeps going.</span>
          </p>
        )}
      </div>
    </div>
  )
}
