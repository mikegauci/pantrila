"use client"

import { useCallback, useSyncExternalStore } from "react"

// --- Temperatures found in step text --------------------------------------------------------
// Display only: the stored recipe keeps the text exactly as the source wrote it.

export type TempUnit = "C" | "F"

// "350°F", "350 °F", "350F", "350 degrees F", "175-180°C", "175 to 180 degrees Celsius"
const TEMP = String.raw`(\d{2,3})(?:(\s*(?:-|–|to)\s*)(\d{2,3}))?(?:\s*[°º˚]\s*|\s+degrees?\s+|)(Fahrenheit|Celsius|F|C)\b`
const FLAGS = "gi"
const SINGLE = new RegExp(String.raw`(?<![\d.])${TEMP}`, FLAGS)
// Sources often give both: "350°F / 180°C", "350°F (180°C)", "180°C or 350°F".
const DUAL = new RegExp(String.raw`(?<![\d.])${TEMP}(\s*/\s*|\s+or\s+|\s*\(\s*)${TEMP}(\s*\))?`, FLAGS)

const unitOf = (word: string): TempUnit => (word[0].toUpperCase() === "F" ? "F" : "C")

/** Oven-style rounding: 350°F -> 180°C, 200°C -> 400°F; small numbers (meat, candy) stay exact. */
export function convertTemp(value: number, to: TempUnit): number {
  if (to === "C") {
    const c = ((value - 32) * 5) / 9
    return c >= 120 ? Math.round(c / 10) * 10 : Math.round(c)
  }
  const f = (value * 9) / 5 + 32
  return f >= 240 ? Math.round(f / 25) * 25 : Math.round(f)
}

function single(text: string, to: TempUnit): string {
  return text.replace(SINGLE, (whole, lo: string, sep: string | undefined, hi: string | undefined, word: string) => {
    if (unitOf(word) === to) return whole
    const out = `${convertTemp(Number(lo), to)}${sep ? `${sep}${convertTemp(Number(hi), to)}` : ""}`
    return `${out}°${to}`
  })
}

/** The step with every temperature shown in `to`; a "350°F (180°C)" pair collapses to one. */
export function showTemps(text: string, to: TempUnit): string {
  const paired = text.replace(DUAL, (whole, ...g: (string | undefined)[]) => {
    const [lo1, sep1, hi1, word1, join, lo2, sep2, hi2, word2, close] = g
    const [u1, u2] = [unitOf(word1!), unitOf(word2!)]
    if (u1 === u2 || (join!.includes("(") && !close)) return single(whole, to)
    const [lo, sep, hi] = u1 === to ? [lo1, sep1, hi1] : [lo2, sep2, hi2]
    return `${lo}${sep ? `${sep}${hi}` : ""}°${to}`
  })
  return single(paired, to)
}

export function hasTemp(texts: string[]): boolean {
  return texts.some((t) => new RegExp(SINGLE.source, "i").test(t))
}

// --- The person's choice, kept in this browser ---------------------------------------------

const KEY = "pantrila-temp-unit"
const EVENT = "pantrila-temp-unit"

function read(): TempUnit {
  try {
    return localStorage.getItem(KEY) === "F" ? "F" : "C"
  } catch {
    return "C"
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(EVENT, onChange)
  }
}

export function useTempUnit(): [TempUnit, (unit: TempUnit) => void] {
  const unit = useSyncExternalStore(subscribe, read, () => "C" as TempUnit)
  const set = useCallback((next: TempUnit) => {
    try {
      localStorage.setItem(KEY, next)
    } catch {}
    window.dispatchEvent(new Event(EVENT))
  }, [])
  return [unit, set]
}
