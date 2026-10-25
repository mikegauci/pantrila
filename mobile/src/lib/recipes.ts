import { label } from "@pantrila/core/format"
import type { DietTag, MealType, SearchRules } from "@pantrila/core/types"

export const TIMES = [15, 30, 45, 60]
export const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"]
export const DIETS: DietTag[] = ["vegan", "vegetarian", "gluten_free", "dairy_free", "high_protein", "low_carb"]

export interface RecipeFilters {
  q: string
  meal: MealType[]
  time: number | null
  diets: DietTag[]
  cuisine: string[]
  safe: boolean
}

/** The `/recipes` query for these filters (without the page). */
export function recipeParams(f: RecipeFilters): URLSearchParams {
  const params = new URLSearchParams({ q: f.q, safe: String(f.safe) })
  f.meal.forEach((m) => params.append("meal", m))
  if (f.time) params.set("max_minutes", String(f.time))
  f.cuisine.forEach((c) => params.append("cuisine", c))
  f.diets.forEach((d) => params.append("diet", d))
  return params
}

/** The profile rules the API applied, in words for the safety banner (as on the web). */
export function rulesText(r: SearchRules): string[] {
  const out = []
  if (r.exclude_allergens.length) out.push(`no ${r.exclude_allergens.map(label).join(", ").toLowerCase()}`)
  if (r.require_diets.length) out.push(r.require_diets.map(label).join(", ").toLowerCase())
  if (r.exclude_foods.length) out.push(`without ${r.exclude_foods.map(label).join(", ").toLowerCase()}`)
  if (r.max_minutes) out.push(`${r.max_minutes} min or less`)
  return out
}
