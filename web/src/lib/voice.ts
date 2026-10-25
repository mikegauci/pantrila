"use client"

import { useEffect, useRef, useState, useSyncExternalStore } from "react"

import { voiceCommand, type VoiceCommand, type VoiceError, type VoiceListener } from "@pantrila/core/voice"

// --- Listening in the browser --------------------------------------------------------------

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
