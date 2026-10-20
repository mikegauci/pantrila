"use client"

import { useEffect, useState } from "react"

/** A rough request estimate, never a claim about server progress or an expiry timer. */
export function ImportCountdown({ estimatedSeconds }: { estimatedSeconds: number }) {
  const [startedAt] = useState(() => Date.now())
  const [now, setNow] = useState(startedAt)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  const elapsed = Math.max(0, Math.floor((now - startedAt) / 1000))
  const remaining = Math.max(0, estimatedSeconds - elapsed)
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
  return (
    <div role="status" className="grid gap-1 rounded-2xl bg-yellow-soft p-4 text-[13px]">
      <p className="font-semibold">{elapsed < 8 ? "Reading the caption…" : "Reading the post and its video…"}</p>
      {remaining > 0
        ? <p role="timer" aria-live="off" className="tabular">Estimated time remaining: {clock}</p>
        : <p>Taking longer than usual. Still working…</p>}
      <p className="text-[12px] text-muted-foreground">An estimate based on recent imports. Videos can take longer.</p>
    </div>
  )
}
