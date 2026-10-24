"use client"

import { useEffect } from "react"

import { useAuth } from "@/components/auth-provider"
import { replayChoice, startReplay, stopReplay } from "@/lib/replay"

export const REPLAY_EXPLAINER =
  "Pantrila records how you use the app: taps, scrolling and the screens you see, including your diet " +
  "and allergy settings. Anything you type is hidden. Recordings are kept for 30 days and deleted with your account."

/** Starts replay for whoever is signed in unless they turned it off in Profile; stops it on sign-out. */
export function ReplaySession() {
  const { session } = useAuth()
  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) {
      stopReplay()
      return
    }
    if (replayChoice(userId) === "on") void startReplay(userId)
  }, [userId])

  return null
}
