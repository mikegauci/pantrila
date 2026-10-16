import type { MealType } from "@/lib/types"

export const label = (key: string) => {
  const s = key.replaceAll("_", " ")
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export const kcal = (n: number) => `${Math.round(n).toLocaleString("en-GB")} kcal`
export const grams = (n: number) => `${Math.round(n)} g`

export const usd = (n: number | null | undefined, digits = 4) =>
  n == null ? "n/a" : `$${n.toFixed(digits)}`

export const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`

export const MEAL_ORDER: MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"]

/** Which plan day is "today": day 1 is the day the plan was made, wrapping after the last. */
export function planDayIndex(createdAt: string, days: number): number {
  const start = new Date(createdAt)
  start.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const elapsed = Math.floor((today.getTime() - start.getTime()) / 86_400_000)
  return ((Math.max(0, elapsed) % days) + days) % days
}

export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  return sorted[Math.max(0, i)]
}
