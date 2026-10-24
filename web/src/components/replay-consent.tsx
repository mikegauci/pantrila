"use client"

import { Video } from "lucide-react"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"

import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { replayAvailable, replayChoice, setReplayChoice, startReplay, stopReplay } from "@/lib/replay"

const tourDone = (userId: string) => {
  try {
    return localStorage.getItem(`pantrila-tour-done:${userId}`) === "1"
  } catch {
    return true
  }
}

export const REPLAY_EXPLAINER =
  "Pantrila records how you use the app: taps, scrolling and the screens you see, including your diet and " +
  "allergy settings. Anything you type is hidden. Recordings are kept for 30 days and deleted with your account."

/** Starts or stops replay for whoever is signed in, and asks once (after the tour) whether to record. */
export function ReplayConsent() {
  const { session } = useAuth()
  const pathname = usePathname()
  const userId = session?.user.id ?? null
  const [answered, setAnswered] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!userId) {
      stopReplay()
      return
    }
    if (replayChoice(userId) === "on") void startReplay(userId)
  }, [userId])

  // Ask only once the first-run tour is out of the way (re-checked every 2 s until then).
  const undecided = Boolean(userId && replayAvailable() && !answered && replayChoice(userId) === null)
  useEffect(() => {
    if (!undecided) return
    const timer = setInterval(() => setTick((n) => n + 1), 2000)
    return () => clearInterval(timer)
  }, [undecided])
  const ask = undecided && tourDone(userId!)

  // Never over full-screen cooking mode.
  if (!ask || !userId || pathname.endsWith("/cook")) return null

  function choose(choice: "on" | "off") {
    if (userId) setReplayChoice(userId, choice)
    setAnswered(true)
  }

  return (
    <section role="dialog" aria-labelledby="replay-title"
      className="fixed inset-x-3 bottom-20 z-30 rounded-[20px] border bg-surface p-4 shadow-soft md:inset-x-auto md:right-6 md:bottom-6 md:max-w-sm">
      <h2 id="replay-title" className="flex items-center gap-2 font-semibold">
        <Video className="size-4 text-primary" aria-hidden /> Help improve Pantrila?
      </h2>
      <p className="mt-2 text-[13px] text-muted-foreground">
        {REPLAY_EXPLAINER} You can change this in Profile.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => choose("on")}>Yes, record my visits</Button>
        <Button size="sm" variant="outline" onClick={() => choose("off")}>No thanks</Button>
      </div>
    </section>
  )
}
