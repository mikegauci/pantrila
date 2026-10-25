import { describe, expect, it } from "vitest"

import { convertTemp, fanTemp, hasTemp, showTemps } from "../src/temperature"

describe("convertTemp", () => {
  it("rounds oven temperatures like cookbooks", () => {
    expect(convertTemp(350, "C")).toBe(180)
    expect(convertTemp(200, "F")).toBe(400)
  })

  it("keeps small temperatures exact", () => {
    expect(convertTemp(165, "C")).toBe(74)
    expect(convertTemp(63, "F")).toBe(145)
  })
})

describe("fanTemp", () => {
  it("drops about 25°F for a fan oven", () => {
    expect(fanTemp(180, "C", "C")).toBe(165)
    expect(fanTemp(350, "F", "F")).toBe(325)
  })
})

describe("showTemps", () => {
  it("adds the fan setting to oven steps", () => {
    expect(showTemps("Bake at 180°C for 20 minutes.", "C")).toBe("Bake at 180°C (165°C fan) for 20 minutes.")
    expect(showTemps("Bake at 350°F.", "C")).toBe("Bake at 180°C (165°C fan).")
  })

  it("collapses a pair to the chosen unit", () => {
    expect(showTemps("Roast at 350°F (180°C).", "C")).toBe("Roast at 180°C (165°C fan).")
  })

  it("leaves fan and non-oven steps without a fan note", () => {
    expect(showTemps("Bake in a fan oven at 160°C.", "C")).toBe("Bake in a fan oven at 160°C.")
    expect(showTemps("Cook the chicken to 74°C.", "F")).toBe("Cook the chicken to 165°F.")
  })

  it("finds temperatures", () => {
    expect(hasTemp(["Mix well.", "Heat to 200 degrees C."])).toBe(true)
    expect(hasTemp(["Mix well."])).toBe(false)
  })
})
