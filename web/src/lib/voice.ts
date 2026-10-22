"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"

// --- Commands -------------------------------------------------------------------------------

export type VoiceCommand = "next" | "back" | "start-timer" | "stop-timer"

/** What each command does, for the commands list and the tour. */
export const VOICE_COMMANDS: { say: string; does: string }[] = [
  { say: "Next", does: "Go to the next step" },
  { say: "Back", does: "Go to the previous step" },
  { say: "Start timer", does: "Start this step's timer, or resume a paused one" },
  { say: "Stop timer", does: "Silence a finished timer, or pause the running one" },
]

const NEXT = new Set(["next", "forward", "continue"])
const BACK = new Set(["back", "previous", "backward", "backwards"])
const STOP = new Set(["stop", "pause", "cancel", "silence", "quiet", "off", "end", "enough", "dismiss"])

/** The command in one heard phrase, or null. Words, not the platform, decide, so a native app can
 * reuse this with its own speech recognition: "go to the next step" -> next, "stop" -> stop-timer. */
export function voiceCommand(heard: string): VoiceCommand | null {
  const words = heard.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean)
  // "start the timer", "set a timer", "resume timer"; any stop word makes it a stop.
  if (words.some((w) => w === "timer" || w === "timers" || w === "alarm")) {
    return words.some((w) => STOP.has(w)) ? "stop-timer" : "start-timer"
  }
  // The last command word wins: "no, go back" is back.
  for (let i = words.length - 1; i >= 0; i--) {
    if (NEXT.has(words[i])) return "next"
    if (BACK.has(words[i])) return "back"
    if (words[i] === "stop" || words[i] === "pause" || words[i] === "silence") return "stop-timer"
  }
  return null
}

// --- Listening ------------------------------------------------------------------------------

/** One way of hearing phrases: the browser here, a native speech module in an app later. */
export interface VoiceListener {
  start(): void
  stop(): void
}

export type VoiceError = "denied" | "failed"

// The Web Speech API is not in TypeScript's DOM types; only what is used here.
interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionClass = new () => Recognition

function recognitionClass(): RecognitionClass | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as { SpeechRecognition?: RecognitionClass; webkitSpeechRecognition?: RecognitionClass }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Speech recognition in the browser (Chrome sends audio to Google, Safari to Apple). Safari and
 * Chrome stop listening after a pause, so it restarts until `stop`. */
export function browserListener(onHeard: (text: string) => void, onError: (e: VoiceError) => void): VoiceListener | null {
  const Recognition = recognitionClass()
  if (!Recognition) return null
  let rec: Recognition | null = null
  let on = false
  let quickEnds = 0
  let startedAt = 0

  const begin = () => {
    rec = new Recognition()
    rec.lang = navigator.language?.startsWith("en") ? navigator.language : "en-US"
    rec.continuous = true
    rec.interimResults = false
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) onHeard(e.results[i][0]?.transcript ?? "")
      }
    }
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        on = false
        onError("denied")
      }
    }
    rec.onend = () => {
      if (!on) return
      // Ending again and again within a second means it cannot listen; stop instead of looping.
      quickEnds = Date.now() - startedAt < 1000 ? quickEnds + 1 : 0
      if (quickEnds >= 5) {
        on = false
        onError("failed")
        return
      }
      try {
        startedAt = Date.now()
        rec?.start()
      } catch {
        on = false
        onError("failed")
      }
    }
    startedAt = Date.now()
    rec.start()
  }

  return {
    start() {
      if (on) return
      on = true
      quickEnds = 0
      try {
        begin()
      } catch {
        on = false
        onError("failed")
      }
    },
    stop() {
      on = false
      try {
        rec?.abort()
      } catch {}
      rec = null
    },
  }
}

const noSubscribe = () => () => {}

export const useVoiceSupported = () =>
  useSyncExternalStore(noSubscribe, () => recognitionClass() !== null, () => false)

/** Listen while `enabled` and the page is visible (a locked phone stops it; unlocking resumes). */
export function useVoiceCommands(
  enabled: boolean,
  onCommand: (c: VoiceCommand) => void,
  onError: (e: VoiceError) => void,
): boolean {
  const [listening, setListening] = useState(false)
  const handlers = useRef({ onCommand, onError })
  useEffect(() => { handlers.current = { onCommand, onError } }, [onCommand, onError])

  useEffect(() => {
    if (!enabled) return
    const listener = browserListener(
      (text) => {
        const c = voiceCommand(text)
        if (c) handlers.current.onCommand(c)
      },
      (e) => {
        setListening(false)
        handlers.current.onError(e)
      },
    )
    if (!listener) return
    const sync = () => {
      if (document.visibilityState === "visible") {
        listener.start()
        setListening(true)
      } else {
        listener.stop()
        setListening(false)
      }
    }
    sync()
    document.addEventListener("visibilitychange", sync)
    return () => {
      document.removeEventListener("visibilitychange", sync)
      listener.stop()
      setListening(false)
    }
  }, [enabled])

  return enabled && listening
}
