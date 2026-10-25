import { describe, expect, it } from "vitest"

import { cookPortions, kcalGoal, kcalMet, kcalTargetText, leftoverSources, leftoversOf, mealKcal, repeatChoices } from "../src/plan"
import type { MealType, NutritionTargets, Plan, PlanMeal, RecipeCard } from "../src/types"

const nutrition = { kcal: 500, protein_g: 30, carbs_g: 50, fat_g: 20, fibre_g: 5 }

const recipe = (id: string): RecipeCard => ({
  id, title: id, summary: "", cuisine: "", meal_types: ["dinner"], diet_tags: [], allergens: [],
  total_minutes: 30, servings: 2, nutrition, ingredient_count: 5, pantry_foods: [], problems: [], photo_url: null,
})

const meal = (meal_type: MealType, over: Partial<PlanMeal> = {}): PlanMeal => ({
  meal_type, portions: 1, recipe: recipe(`${meal_type}-r`), kind: "recipe", cookbook_id: null,
  from_day: null, from_meal: null, out_kcal: null, ...over,
})

const targets: NutritionTargets = { kcal: 2000, min_protein_g: null, max_carbs_g: null }

const plan: Plan = {
  id: 1, created_at: "2026-10-25T08:00:00Z", notes: "", targets, problems: [],
  report: {} as Plan["report"],
  days: [
    { day: 1, nutrition, meals: [meal("lunch"), meal("dinner")] },
    { day: 2, nutrition, meals: [meal("lunch", { kind: "leftovers", from_day: 1, from_meal: "dinner" }), meal("dinner", { kind: "skipped" })] },
    { day: 3, nutrition, meals: [meal("lunch", { kind: "eating_out", out_kcal: 800 }), meal("dinner")] },
  ],
}

describe("energy targets", () => {
  it("reads one number or a range", () => {
    expect(kcalTargetText(targets)).toBe("2000 kcal")
    expect(kcalTargetText({ ...targets, min_kcal: 1600, max_kcal: 1900 })).toBe("1600–1900 kcal")
    expect(kcalTargetText({ ...targets, kcal: null, min_kcal: 2800 })).toBe("at least 2800 kcal")
    expect(kcalGoal({ ...targets, min_kcal: 1600, max_kcal: 1900 })).toBe(1750)
  })

  it("meets a range anywhere inside it, one number within 10%", () => {
    const range = { ...targets, min_kcal: 1600, max_kcal: 1900 }
    expect(kcalMet(1601, range)).toBe(true)
    expect(kcalMet(1950, range)).toBe(false)
    expect(kcalMet(2190, targets)).toBe(true)
    expect(kcalMet(2300, targets)).toBe(false)
  })
})

describe("meals", () => {
  it("counts energy by kind", () => {
    expect(mealKcal(meal("lunch", { portions: 1.5 }))).toBe(750)
    expect(mealKcal(meal("lunch", { kind: "skipped" }))).toBe(0)
    expect(mealKcal(meal("lunch", { kind: "eating_out", out_kcal: null }))).toBeNull()
  })

  it("finds leftovers and the portions to cook", () => {
    expect(leftoverSources(plan, 3).map((s) => `${s.day} ${s.meal}`)).toEqual(["1 lunch", "1 dinner"])
    expect(leftoversOf(plan, 1, "dinner")).toEqual(["day 2 lunch"])
    expect(cookPortions(plan, 1, "dinner")).toEqual({ total: 2, later: 1 })
  })

  it("offers later meals to repeat on", () => {
    const choices = repeatChoices(plan, 1, "dinner")
    expect(choices.map((c) => [c.day, c.meal, c.now, c.already])).toEqual([
      [2, "lunch", "lunch-r", true], [2, "dinner", "Skipped", false],
      [3, "lunch", "Eating out", false], [3, "dinner", "dinner-r", false],
    ])
    expect(choices.every((c) => c.blocked === null)).toBe(true)
  })
})
