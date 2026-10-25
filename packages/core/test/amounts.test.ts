import { describe, expect, it } from "vitest"

import { amountIn, bareName, convertAmount, formatAmount, fraction, niceFractions, unitsFor } from "../src/amounts"

describe("fraction", () => {
  it("rounds to the nearest kitchen fraction", () => {
    expect(fraction(1.25)).toBe("1¼")
    expect(fraction(0.5)).toBe("½")
    expect(fraction(0.33)).toBe("⅓")
    expect(fraction(2)).toBe("2")
    expect(fraction(1.97)).toBe("2")
  })

  it("never shows 0 for an amount above 0", () => {
    expect(fraction(0.01)).toBe("⅛")
    expect(fraction(0)).toBe("0")
  })
})

describe("niceFractions", () => {
  it("turns typed fractions into fraction characters", () => {
    expect(niceFractions("1 1/2 cups flour")).toBe("1½ cups flour")
    expect(niceFractions("1/4 tsp salt")).toBe("¼ tsp salt")
    expect(niceFractions("1-1/4 teaspoons")).toBe("1¼ teaspoons")
  })

  it("leaves dates and other numbers alone", () => {
    expect(niceFractions("on 12/25")).toBe("on 12/25")
    expect(niceFractions("5/6 done")).toBe("5/6 done")
  })
})

describe("formatAmount", () => {
  it("shows US measures as fractions and metric as numbers", () => {
    expect(formatAmount(1.25, "tsp")).toBe("1¼")
    expect(formatAmount(454.4, "g")).toBe("454")
    expect(formatAmount(2.25, "g")).toBe("2.3")
    expect(formatAmount(1.234, "kg")).toBe("1.23")
  })
})

describe("unit conversion", () => {
  const rice = { quantity: 1, unit: "cup" as const, grams: 185, grams_per_ml: 185 / 240, grams_per_piece: null }

  it("lists the units a line can be shown in, its own first", () => {
    expect(unitsFor(rice)).toEqual(["cup", "g", "oz", "lb", "ml", "tsp", "tbsp"])
    expect(unitsFor({ quantity: 2, unit: "piece" })).toEqual(["piece"])
  })

  it("converts a line through its grams", () => {
    expect(amountIn(rice, "g")).toBeCloseTo(185)
    expect(amountIn(rice, "cup", 2)).toBe(2)
    expect(amountIn(rice, "oz")).toBeCloseTo(6.53, 2)
  })

  it("converts a form amount when the unit changes", () => {
    expect(convertAmount(1, "cup", "g", 185 / 240)).toBe(185)
    expect(convertAmount(1, "cup", "g")).toBeNull()
    expect(convertAmount(2, "piece", "g", null, 50)).toBe(100)
    expect(convertAmount(1, "g", "g")).toBeNull()
  })
})

describe("bareName", () => {
  it("drops a leading amount", () => {
    expect(bareName("1 cup basmati rice")).toBe("basmati rice")
    expect(bareName("1-1/4 teaspoons salt")).toBe("salt")
    expect(bareName("½ lb ground beef")).toBe("ground beef")
    expect(bareName("2 pinches of salt")).toBe("salt")
    expect(bareName("1 cup (185g) rice")).toBe("rice")
  })

  it("keeps names that do not start with an amount", () => {
    expect(bareName("olive oil")).toBe("olive oil")
    expect(bareName("2 x 400g cans")).toBe("2 x 400g cans")
  })
})
