import { describe, expect, it } from "vitest"

import { clock, duration, mentioned, preheatHint, stepTimers, stepUses } from "../src/cooking"

describe("stepTimers", () => {
  it("finds durations, taking the lower bound of a range", () => {
    expect(stepTimers("Simmer for 10 to 12 minutes.")).toEqual([{ label: "10–12 min", seconds: 600 }])
    expect(stepTimers("Fry 3-4 min per side.")).toEqual([{ label: "3–4 min per side", seconds: 180 }])
    expect(stepTimers("Bake for 1 hour and 15 minutes.")).toEqual([{ label: "1 h 15 min", seconds: 4500 }])
    expect(stepTimers("Rest for half an hour.")).toEqual([{ label: "30 min", seconds: 1800 }])
  })

  it("ignores steps without a time", () => {
    expect(stepTimers("Season to taste.")).toEqual([])
  })
})

describe("duration and clock", () => {
  it("reads times plainly", () => {
    expect(duration(90)).toBe("1.5 min")
    expect(duration(3600)).toBe("1 h")
    expect(duration(30)).toBe("30 sec")
    expect(clock(245_000)).toBe("4:05")
    expect(clock(3_750_000)).toBe("1:02:30")
    expect(clock(-5)).toBe("0:00")
  })
})

describe("preheatHint", () => {
  it("points a preheat step at the next timed step", () => {
    const steps = ["Preheat the oven to 180°C.", "Mix the flour and sugar.", "Bake at 180°C for 9-12 minutes. Cool."]
    expect(preheatHint(steps, 0)).toEqual({ step: 3, sentence: "Bake at 180°C for 9-12 minutes." })
    expect(preheatHint(steps, 1)).toBeNull()
  })
})

describe("ingredients a step uses", () => {
  const ingredients = [
    { name: "2 tbsp olive oil", food: "olive_oil", unit: "tbsp", section: "Chicken" },
    { name: "500 g chicken", food: "chicken", unit: "g", section: "Chicken" },
    { name: "1 tsp paprika", food: "paprika", unit: "tsp", section: "Chicken" },
    { name: "1 tbsp olive oil", food: "olive_oil", unit: "tbsp", section: "Broth" },
    { name: "Salt and pepper", food: null, unit: "pinch", section: "Broth" },
  ]

  it("matches food and line names", () => {
    expect(mentioned("Add the chicken and some pepper.", ingredients)).toEqual([1, 4])
  })

  it("keeps the line from the step's own group and brings in its seasonings", () => {
    const steps = ["Toss the chicken with the olive oil and seasonings.", "Warm the olive oil for the broth."]
    const headings = ["Rice & Chicken", "Broth"]
    expect(stepUses(steps, ingredients, (n) => headings[n - 1])).toEqual([[0, 1, 2], [3]])
  })
})
