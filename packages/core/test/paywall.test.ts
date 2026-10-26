import { describe, expect, it } from "vitest"

import { periodText, renewalText, resetsText, savingText, trialLine, type Offer } from "../src/subscription"

const yearly: Offer = { period: "year", price: "€29.99", amount: 29.99, perMonth: "€2.50", trial: "P1W" }
const monthly: Offer = { period: "month", price: "€4.99", amount: 4.99, perMonth: "€4.99", trial: "P7D" }

describe("paywall words", () => {
  it("reads store periods", () => {
    expect(periodText("P1W")).toBe("7 days")
    expect(periodText("P3D")).toBe("3 days")
    expect(periodText("P1M")).toBe("1 month")
    expect(periodText("P2Y")).toBe("2 years")
    expect(periodText("week")).toBeNull()
  })

  it("puts the trial before the price and works out the yearly saving", () => {
    expect(trialLine(yearly)).toBe("7 days free, then €29.99 a year")
    expect(trialLine({ ...monthly, trial: null })).toBe("€4.99 a month")
    expect(savingText(yearly, monthly)).toBe("Save 50%")
    expect(savingText({ ...yearly, amount: 59 }, monthly)).toBeNull()
  })

  it("states the renewal terms for each store", () => {
    const apple = renewalText(yearly, "app_store")
    expect(apple).toContain("charged to your Apple ID when the free trial ends")
    expect(apple).toContain("at least 24 hours before it renews")
    const google = renewalText({ ...monthly, trial: null }, "play_store")
    expect(google).toContain("€4.99 a month, charged to your Google Play account when you confirm")
    expect(google).not.toContain("24 hours")
  })

  it("says when a Free cap comes back", () => {
    expect(resetsText("plan", "2026-11-02T00:00:00+00:00")).toBe("It comes back on Monday 2 November.")
    expect(resetsText("photo", "2026-11-02T00:00:00+00:00")).toBeNull()
  })
})
