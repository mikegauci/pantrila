import { recipeParams, rulesText } from "@/lib/recipes"
import { slowRequest, useWaking } from "@/lib/waking"
import { renderHook, act } from "@testing-library/react-native"

import { RULES } from "@/test/fixtures"

it("turns the filters into the /recipes query", () => {
  const params = recipeParams({ q: "tofu", meal: ["lunch", "dinner"], time: 30, diets: ["vegan"], cuisine: ["thai"], safe: false })
  expect(params.toString()).toBe("q=tofu&safe=false&meal=lunch&meal=dinner&max_minutes=30&cuisine=thai&diet=vegan")
})

it("says which profile rules the list follows", () => {
  expect(rulesText(RULES)).toEqual([])
  expect(rulesText({ ...RULES, exclude_allergens: ["milk", "tree_nuts"], require_diets: ["vegan"],
                     exclude_foods: ["mushroom"], max_minutes: 30 }))
    .toEqual(["no milk, tree nuts", "vegan", "without mushroom", "30 min or less"])
})

it("shows the wake-up notice while any slow request waits", async () => {
  const { result } = await renderHook(() => useWaking())
  expect(result.current).toBe(false)
  let first = () => {}
  let second = () => {}
  await act(async () => { first = slowRequest(); second = slowRequest() })
  expect(result.current).toBe(true)
  await act(async () => { first(); first() })  // ending twice counts once
  expect(result.current).toBe(true)
  await act(async () => second())
  expect(result.current).toBe(false)
})
