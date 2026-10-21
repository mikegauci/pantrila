"use client"

import { useEffect, useState, useSyncExternalStore } from "react"

// --- Timers found in step text --------------------------------------------------------------

export interface StepTimer {
  label: string // as written, shortened: "3–4 min per side"
  seconds: number // the lower bound of a range: check early, add time if needed
}

const WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, half: 0.5,
}
const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75 }
const NUM = String.raw`(\d+(?:[.,]\d+)?\s*[½¼¾]?|[½¼¾]|forty-five|${Object.keys(WORDS).filter((w) => w !== "forty-five").join("|")})`
const UNIT = String.raw`(hours?|hrs?|minutes?|mins?|seconds?|secs?)`
const TIMER = new RegExp(
  String.raw`\b${NUM}(?:\s*(?:-|–|to|or)\s*${NUM})?\s*(?:an?\s+)?${UNIT}\b(?:,?\s*(?:and\s+)?(\d+)\s*(?:minutes?|mins?)\b)?(\s+(?:per|on each|each) side)?`,
  "gi",
)
const UNIT_SECONDS = (unit: string) => (unit.startsWith("h") ? 3600 : unit.startsWith("m") ? 60 : 1)
const MAX_SECONDS = 24 * 3600

function num(text: string): number {
  const t = text.trim().toLowerCase()
  if (t in WORDS) return WORDS[t]
  const frac = t.match(/[½¼¾]$/)
  const whole = parseFloat(t.replace(",", ".")) || 0
  return frac ? whole + FRACTIONS[frac[0]] : whole
}

export function duration(seconds: number): string {
  if (seconds >= 3600) {
    const h = Math.floor(seconds / 3600)
    const m = Math.round((seconds % 3600) / 60)
    return m ? `${h} h ${m} min` : `${h} h`
  }
  if (seconds >= 60) {
    const m = seconds / 60
    return `${Number.isInteger(m) ? m : m.toFixed(1)} min`
  }
  return `${seconds} sec`
}

/** "3–4 min", or "45 min–1 h" when the units differ. */
function range(lo: number, hi: number): string {
  const [a, b] = [duration(lo).split(" "), duration(hi).split(" ")]
  return a.length === 2 && b.length === 2 && a[1] === b[1] ? `${a[0]}–${b.join(" ")}` : `${a.join(" ")}–${b.join(" ")}`
}

/** Durations a step names ("simmer for 10 to 12 minutes"), in code; no model involved. */
export function stepTimers(step: string): StepTimer[] {
  const out: StepTimer[] = []
  for (const m of step.matchAll(TIMER)) {
    const [, lo, hi, unit, extraMin, side] = m
    const per = UNIT_SECONDS(unit.toLowerCase())
    const extra = extraMin ? Number(extraMin) * 60 : 0
    const seconds = Math.round(num(lo) * per + extra)
    if (seconds < 5 || seconds > MAX_SECONDS) continue
    const upper = hi ? Math.round(num(hi) * per) : 0
    let label = upper > seconds ? range(seconds, upper) : duration(seconds)
    if (side) label += " per side"
    out.push({ label, seconds })
  }
  return out
}

/** A heads-up for a preheat step that names no time: the duration of the next timed step (usually the bake), if any. */
export function preheatNote(steps: string[], index: number): string | null {
  const step = steps[index]
  if (!/\bpre-?heat|\bheat (?:the|your) oven/i.test(step) || stepTimers(step).length) return null
  for (let i = index + 1; i < Math.min(steps.length, index + 4); i++) {
    const [timer] = stepTimers(steps[i])
    if (timer) return `Coming up in step ${i + 1}: ${timer.label}.`
  }
  return null
}

// --- Ingredients a step mentions ------------------------------------------------------------

/** Indexes of the ingredients whose food or line name the step text mentions. */
export function mentioned(step: string, ingredients: { name: string; food: string | null }[]): number[] {
  const text = ` ${step.toLowerCase().replace(/[^a-z\s]/g, " ")} `
  const has = (phrase: string) => {
    const p = phrase.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim()
    if (p.length < 3) return false
    const forms = [p, p.replace(/(es|s)$/, ""), `${p}s`, `${p}es`]
    return forms.some((f) => f.length >= 3 && text.includes(` ${f} `))
  }
  return ingredients.flatMap((ing, i) => {
    const name = ing.name.split(/[,(]/)[0]
    // "Salt and pepper" is two foods on one line: either word counts.
    const parts = name.split(/\s+(?:and|&)\s+/)
    const food = ing.food?.replaceAll("_", " ") ?? ""
    const lastWord = food.split(" ").slice(-1)[0] ?? ""
    return has(name) || (parts.length > 1 && parts.some(has)) || has(food) || (lastWord.length >= 3 && has(lastWord))
      ? [i] : []
  })
}

/** Step words that stand for every seasoning of the step's group ("whisk the oil and seasonings"). */
const SEASONINGS_WORDS = /\b(seasonings?|spices|spice (?:mix|mixture|blend|rub)|dry rub)\b/i
/** Dried spices, herbs and salt; a line measured in teaspoons or pinches counts too. */
const SEASONING_FOODS = new RegExp(String.raw`\b(${[
  "salt", "pepper", "peppercorns?", "paprika", "oregano", "thyme", "basil", "rosemary", "sage", "dill",
  "cumin", "coriander", "turmeric", "curry powder", "chil[il]i (?:powder|flakes)", "cayenne", "mustard",
  "cinnamon", "nutmeg", "allspice", "cloves", "cardamom", "garlic powder", "onion powder", "seasoning",
  "spice", "herbes de provence", "za.?atar", "sumac", "five spice", "garam masala",
].join("|")})\b`, "i")
const SEASONING_UNITS = new Set(["tsp", "pinch"])

/** Words of a heading or group name, for matching one to the other ("Chicken" ~ "Rice & Chicken"). */
function headingWords(title: string): Set<string> {
  const skip = new Set(["and", "the", "for", "with", "optional"])
  return new Set(title.toLowerCase().split(/[^a-z]+/)
    .filter((w) => w.length >= 3 && !skip.has(w)).map((w) => w.replace(/s$/, "")))
}

/** The ingredients each step uses, as indexes. On top of `mentioned`: when the method has
 *  headings, a food that appears on several lines ("2 tbsp olive oil" for the chicken, "1 tbsp
 *  olive oil" for the broth) keeps only the line from the group that matches the step's heading,
 *  else the first one an earlier step has not used; and "seasonings" or "spices" bring in the
 *  seasoning lines of that group. */
export function stepUses(
  steps: string[],
  ingredients: { name: string; food: string | null; unit: string; section?: string }[],
  headingAt: (step: number) => string,
): number[][] {
  const same = (i: number) => ingredients[i].food ?? ingredients[i].name.split(/[,(]/)[0].trim().toLowerCase()
  const used = new Set<number>()
  return steps.map((step, s) => {
    const heading = headingWords(headingAt(s + 1))
    const inGroup = ingredients.map((ing) =>
      heading.size > 0 && [...headingWords(ing.section ?? "")].some((w) => heading.has(w)))
    const group = inGroup.some(Boolean) ? (i: number) => inGroup[i] : () => true
    const found = new Set(mentioned(step, ingredients))
    if (SEASONINGS_WORDS.test(step)) {
      ingredients.forEach((ing, i) => {
        if (group(i) && (SEASONING_FOODS.test(ing.name) || SEASONING_FOODS.test(ing.food?.replaceAll("_", " ") ?? "")
          || SEASONING_UNITS.has(ing.unit))) found.add(i)
      })
    }
    // One line per food: the step's own group first, then a line not yet used, then the first.
    const pick = new Map<string, number>()
    for (const i of [...found].sort((a, b) => a - b)) {
      const key = same(i)
      const had = pick.get(key)
      const rank = (j: number) => (inGroup.some(Boolean) && inGroup[j] ? 0 : used.has(j) ? 2 : 1)
      if (had === undefined || rank(i) < rank(had)) pick.set(key, i)
    }
    const uses = [...pick.values()].sort((a, b) => a - b)
    uses.forEach((i) => used.add(i))
    return uses
  })
}

// --- Progress kept in the browser -----------------------------------------------------------

export interface RunningTimer {
  id: number
  step: number
  label: string
  seconds: number
  endsAt: number | null // epoch ms while running
  left: number // ms left while paused
  rang: boolean
}

export interface CookProgress {
  page: number // 0 gather, 1..n steps, n+1 finish
  ticked: number[]
  servings: number
  timers: RunningTimer[]
  savedAt: number
}

const KEEP_MS = 12 * 3600 * 1000

export const progressKey = (userId: string, recipe: string) => `pantrila-cook:${userId}:${recipe}`

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

export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0")
  const ss = String(s % 60).padStart(2, "0")
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
