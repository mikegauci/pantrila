import { expect, it } from "vitest"

import { aisleName, byAisle } from "../src/grocery"
import type { GroceryItem } from "../src/types"

const item = (food: string, aisle: string): GroceryItem =>
  ({ food, aisle, need_g: 100, have_g: 0, buy_g: 100, amount: "100 g", recipes: [] })

it("groups the list into runs of one aisle and names them", () => {
  const groups = byAisle([item("rice", "grains"), item("oats", "grains"), item("oil", "oils_condiments")])
  expect(groups.map(([aisle, items]) => [aisleName(aisle), items.map((i) => i.food)])).toEqual([
    ["Grains", ["rice", "oats"]], ["Oils and condiments", ["oil"]],
  ])
  expect(byAisle([])).toEqual([])
})
