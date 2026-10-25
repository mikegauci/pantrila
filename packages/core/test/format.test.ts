import { afterEach, describe, expect, it, vi } from "vitest"

import { avatarFor } from "../src/avatar"
import { ago, kcal, label, percentile, planDayIndex } from "../src/format"

afterEach(() => vi.useRealTimers())

describe("format", () => {
  it("labels keys and energy", () => {
    expect(label("gluten_free")).toBe("Gluten free")
    expect(kcal(1999.6)).toBe("2,000 kcal")
  })

  it("takes percentiles", () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5)
    expect(percentile([], 50)).toBeNull()
  })

  it("counts plan days from the day the plan was made, wrapping", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 9, 25, 9))
    expect(planDayIndex(new Date(2026, 9, 25, 20).toISOString(), 7)).toBe(0)
    expect(planDayIndex(new Date(2026, 9, 23, 8).toISOString(), 7)).toBe(2)
    expect(planDayIndex(new Date(2026, 9, 15).toISOString(), 7)).toBe(3)
  })

  it("says how long ago", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"))
    expect(ago("2026-10-25T11:59:30Z")).toBe("just now")
    expect(ago("2026-10-25T11:55:00Z")).toBe("5 min ago")
    expect(ago("2026-10-25T09:00:00Z")).toBe("3 h ago")
    expect(ago("2026-10-24T10:00:00Z")).toBe("yesterday")
  })
})

describe("avatarFor", () => {
  it("is the same for the same user", () => {
    expect(avatarFor("user-1")).toEqual(avatarFor("user-1"))
    expect(avatarFor("user-1").bg).toMatch(/^bg-/)
  })
})
