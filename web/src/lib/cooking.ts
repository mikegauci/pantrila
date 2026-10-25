"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

import type { CookProgress } from "@pantrila/core/cooking"

// --- Progress kept in the browser -----------------------------------------------------------

const KEEP_MS = 12 * 3600 * 1000

export function loadProgress(key: string): CookProgress | null {
  try {
    const p = JSON.parse(localStorage.getItem(key) ?? "null") as CookProgress | null
    return p && Date.now() - p.savedAt < KEEP_MS ? p : null
  } catch {
    return null
  }
}

export function saveProgress(key: string, p: Omit<CookProgress, "savedAt"> | null) {
  try {
    if (p) localStorage.setItem(key, JSON.stringify({ ...p, savedAt: Date.now() }))
    else localStorage.removeItem(key)
  } catch {}
}

// --- Keep the screen awake ------------------------------------------------------------------

type WakeLockState = "on" | "off" | "unsupported"

const noSubscribe = () => () => {}

/** Hold a screen wake lock while mounted and visible; browsers drop it when the tab hides. */
export function useWakeLock(): WakeLockState {
  const supported = useSyncExternalStore(noSubscribe, () => "wakeLock" in navigator, () => false)
  const [held, setHeld] = useState(false)

  useEffect(() => {
    if (!supported) return
    let lock: WakeLockSentinel | null = null
    let cancelled = false
    const request = async () => {
      if (document.visibilityState !== "visible" || (lock && !lock.released)) return
      try {
        lock = await navigator.wakeLock.request("screen")
        if (cancelled) return void lock.release()
        setHeld(true)
        lock.addEventListener("release", () => setHeld(false))
      } catch {
        setHeld(false) // e.g. battery saver; the page still works
      }
    }
    request()
    document.addEventListener("visibilitychange", request)
    return () => {
      cancelled = true
      document.removeEventListener("visibilitychange", request)
      lock?.release().catch(() => {})
    }
  }, [supported])

  return supported ? (held ? "on" : "off") : "unsupported"
}

// --- Timer alarm ----------------------------------------------------------------------------

/** Three short beeps and a vibration; silent where audio is blocked. */
export function ring() {
  try {
    navigator.vibrate?.([300, 150, 300, 150, 300])
  } catch {}
  try {
    const ctx = new AudioContext()
    for (let i = 0; i < 3; i++) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.frequency.value = 880
      const t = ctx.currentTime + i * 0.45
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.32)
    }
    setTimeout(() => ctx.close(), 1600)
  } catch {}
}

/** One soft rising note: a voice command was heard. Silent where audio is blocked. */
export function chime() {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(660, t)
    osc.frequency.exponentialRampToValueAtTime(990, t + 0.12)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.12, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.27)
    setTimeout(() => ctx.close(), 600)
  } catch {}
}
