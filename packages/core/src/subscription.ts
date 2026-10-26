import type { Allowance, Feature, Subscription } from "./types"

/** Words for Free and Pantrila Pro's allowances, shared by web and the phone app. */

const NOUNS: Record<Feature, [string, string]> = {
  plan: ["plan", "plans"],
  chat: ["message", "messages"],
  import: ["AI import", "AI imports"],
  photo: ["photo", "photos"],
}

const WINDOW_TEXT = { day: "today", week: "this week", month: "this month" } as const

/** "3 of 5 AI imports left this month"; "No photos on Free" for a feature the tier lacks. */
export function leftText(feature: Feature, a: Allowance): string {
  const [one, many] = NOUNS[feature]
  if (a.limit === 0) return `No ${many} on Free`
  return `${a.left} of ${a.limit} ${a.limit === 1 ? one : many} left ${WINDOW_TEXT[a.window]}`
}

/** "1 a week", "50 a day". */
export function perWindow(a: Allowance): string {
  return `${a.limit} a ${a.window}`
}

const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })

/** "Free trial, renews on 2 November 2026", "Pantrila Pro, ends on ...", "Pantrila Free". */
export function subscriptionText(s: Subscription): string {
  if (s.tier === "free") return "Pantrila Free"
  const name = s.status === "trial" ? "Pantrila Pro, free trial" : "Pantrila Pro"
  if (!s.expires_at) return name
  return `${name}, ${s.will_renew ? "renews" : "ends"} on ${date(s.expires_at)}`
}

export const isPro = (s: Subscription | undefined | null) => s?.tier === "pro"

/** The paywall's first line: what Free just ran out of. */
export const USED_UP: Record<Feature, string> = {
  plan: "You have used this week's free meal plan.",
  chat: "You have used today's free assistant messages.",
  import: "You have used this month's free recipe imports.",
  photo: "AI recipe photos come with Pantrila Pro.",
}

/** What Pro gives (the API's `PANTRILA_DAILY_*` defaults). */
export const PRO_GIVES = [
  "5 meal plans a day",
  "20 recipe imports a day, from links, posts, photos or text",
  "50 assistant messages a day",
  "AI photos for your own recipes",
]

/** "It comes back on Monday 2 November." for a Free cap; null for photos, which Free never has. */
export function resetsText(feature: Feature, resetsAt: string): string | null {
  if (feature === "photo") return null
  const day = new Date(resetsAt).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
  return `It comes back on ${day}.`
}

/** One Pro plan as a store sells it: price as the store writes it ("€29.99"), its number, the
 * price a month for a yearly plan, and the free trial as an ISO 8601 period ("P1W"), if any. */
export interface Offer {
  period: "month" | "year"
  price: string
  amount: number
  perMonth: string | null
  trial: string | null
}

/** "P1W" and "P7D" -> "7 days", "P1M" -> "1 month"; null for what is not a period. */
export function periodText(iso: string): string | null {
  const m = /^P(\d+)([DWMY])$/.exec(iso)
  if (!m) return null
  const n = Number(m[1])
  if (m[2] === "D" || m[2] === "W") {
    const days = m[2] === "W" ? n * 7 : n
    return `${days} day${days === 1 ? "" : "s"}`
  }
  const unit = m[2] === "M" ? "month" : "year"
  return `${n} ${unit}${n === 1 ? "" : "s"}`
}

/** "7 days free, then €29.99 a year", or "€4.99 a month" without a trial. */
export function trialLine(o: Offer): string {
  const trial = o.trial && periodText(o.trial)
  return trial ? `${trial} free, then ${o.price} a ${o.period}` : `${o.price} a ${o.period}`
}

/** "Save 50%" for the yearly plan against twelve months; null below 5%. */
export function savingText(yearly: Offer, monthly: Offer): string | null {
  if (!monthly.amount) return null
  const pct = Math.round((1 - yearly.amount / (monthly.amount * 12)) * 100)
  return pct >= 5 ? `Save ${pct}%` : null
}

/** The renewal terms both stores ask for beside the buy button. */
export function renewalText(o: Offer, store: "app_store" | "play_store"): string {
  const trial = o.trial && periodText(o.trial)
  const charged = trial ? "when the free trial ends" : "when you confirm"
  const where = store === "app_store" ? "your Apple ID" : "your Google Play account"
  const settings = store === "app_store" ? "Settings on this iPhone" : "the Play Store's subscriptions"
  const before = store === "app_store" ? " at least 24 hours before it renews" : ""
  return `${o.price} a ${o.period}, charged to ${where} ${charged}. Pantrila Pro renews automatically ` +
    `every ${o.period} until you cancel${before}. Cancel any time in ${settings}; it takes one tap.`
}
