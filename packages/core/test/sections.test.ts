import { describe, expect, it } from "vitest"

import { groupLines, groupSteps, stepHeading, stepsToText, textToSteps } from "../src/sections"

describe("groups", () => {
  it("groups consecutive lines that share a section", () => {
    const groups = groupLines([{ section: "Broth" }, { section: "Broth" }, {}, { section: "Broth" }])
    expect(groups.map((g) => [g.title, g.items.map((i) => i.index)])).toEqual([
      ["Broth", [0, 1]], ["", [2]], ["Broth", [3]],
    ])
  })

  it("splits steps under their headings", () => {
    const groups = groupSteps(["a", "b", "c"], [{ title: "Sauce", first_step: 2 }])
    expect(groups.map((g) => [g.title, g.items.map((i) => i.item)])).toEqual([["", ["a"]], ["Sauce", ["b", "c"]]])
    expect(stepHeading([{ title: "Sauce", first_step: 2 }], 3)).toBe("Sauce")
    expect(stepHeading([{ title: "Sauce", first_step: 2 }], 1)).toBe("")
  })

  it("round-trips the method box text", () => {
    const steps = ["Boil.", "Whisk.", "Pour."]
    const step_sections = [{ title: "Sauce", first_step: 2 }]
    const text = stepsToText(steps, step_sections)
    expect(text).toBe("Boil.\n\n## Sauce\n\nWhisk.\n\nPour.")
    expect(textToSteps(text)).toEqual({ steps, step_sections })
    expect(textToSteps("Boil.\n## Nothing after")).toEqual({ steps: ["Boil."], step_sections: [] })
  })
})
