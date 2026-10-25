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
