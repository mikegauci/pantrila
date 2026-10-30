import { describe, expect, it } from "vitest"

import { UNLIMITED, leftText, perWindow, subscriptionText } from "../src/subscription"
import type { Subscription } from "../src/types"

const at = "2026-11-02T00:00:00+00:00"

describe("subscription words", () => {
  it("says what is left in each window", () => {
    expect(leftText("import", { limit: 5, left: 3, window: "month", resets_at: at })).toBe("3 of 5 AI imports left this month")
    expect(leftText("plan", { limit: 1, left: 0, window: "week", resets_at: at })).toBe("0 of 1 plan left this week")
    expect(leftText("chat", { limit: UNLIMITED, left: UNLIMITED - 3, window: "day", resets_at: at })).toBe("No limit on messages")
    expect(leftText("photo", { limit: 0, left: 0, window: "day", resets_at: at })).toBe("No photos on Free")
    expect(perWindow({ limit: 50, left: 50, window: "day", resets_at: at })).toBe("50 a day")
  })

  it("names the plan and its renewal or end", () => {
    const free: Subscription = { tier: "free", status: null, expires_at: null, will_renew: false, store: null }
    expect(subscriptionText(free)).toBe("Pantrila Free")
    expect(subscriptionText({ ...free, tier: "pro", status: "trial", expires_at: at, will_renew: true, store: "app_store" }))
      .toBe("Pantrila Pro, free trial, renews on 2 November 2026")
    expect(subscriptionText({ ...free, tier: "pro", status: "active", expires_at: at, store: "manual" }))
      .toBe("Pantrila Pro, ends on 2 November 2026")
    expect(subscriptionText({ ...free, tier: "pro", status: "active", store: "manual" })).toBe("Pantrila Pro")
  })
})
