import type { Plan, PlanMeal, RecipeCard, RecipeDetail, RecipeList, SearchRules } from "@pantrila/core/types"

/** Test data shaped like the API's replies. */

export const RULES: SearchRules = {
  exclude_allergens: [], require_diets: [], max_minutes: null, meal_types: [], cuisines: [], exclude_foods: [],
}

export function card(n: number, extra: Partial<RecipeCard> = {}): RecipeCard {
  return {
    id: `recipe-${n}`, title: `Recipe ${n}`, summary: "A test recipe.", cuisine: "italian",
    meal_types: ["dinner"], diet_tags: ["vegetarian"], allergens: [], total_minutes: 25, servings: 2,
    nutrition: { kcal: 520, protein_g: 21, carbs_g: 60, fat_g: 18, fibre_g: 7 }, ingredient_count: 2,
    pantry_foods: [], problems: [], photo_url: null, ...extra,
  }
}

export const list = (recipes: RecipeCard[], rules: Partial<SearchRules> = {}): RecipeList =>
  ({ query: "", rules: { ...RULES, ...rules }, recipes })

export const DETAIL: RecipeDetail = {
  ...card(1, { title: "Baked rice", allergens: ["milk"], problems: ["contains milk"] }),
  ingredients: [
    { name: "rice", food: "rice", quantity: 200, unit: "g", grams: 200, in_pantry: true, grams_per_ml: 0.8 },
    { name: "1 tbsp butter", food: "butter", quantity: 1, unit: "tbsp", grams: 14, in_pantry: false,
      grams_per_ml: 0.95 },
  ],
  steps: ["Preheat the oven to 180°C.", "Bake for 1/2 hour."],
}

const N = { kcal: 600, protein_g: 30, carbs_g: 70, fat_g: 20, fibre_g: 8 }

export function planMeal(meal_type: PlanMeal["meal_type"], over: Partial<PlanMeal> = {}): PlanMeal {
  return {
    meal_type, portions: 1, recipe: card(meal_type === "lunch" ? 1 : 2, { meal_types: [meal_type] }), kind: "recipe",
    cookbook_id: null, from_day: null, from_meal: null, out_kcal: null, ...over,
  }
}

/** Two days: day 1 lunch and dinner cooked, day 2 lunch is leftovers of day 1 dinner and day 2
 * dinner is eating out; energy is a 1600-1900 kcal range. */
export const PLAN: Plan = {
  id: 5, created_at: new Date().toISOString(), notes: "Lots of beans this week.",
  targets: { kcal: null, min_kcal: 1600, max_kcal: 1900, min_protein_g: 100, max_carbs_g: null },
  problems: [],
  report: {
    model: "gpt-5.4-mini", warnings: ["Day 2: 1200 kcal, target 1600-1900 kcal"], first_draft_problems: [], repairs: 0,
    fallbacks: 0, pantry_use: 0.5, path: ["profile", "retrieve", "draft", "check", "finalise"], llm_calls: 2, tool_calls: 1,
    input_tokens: 1000, output_tokens: 500, cost_usd: 0.006, latency_ms: 14200,
  },
  days: [
    { day: 1, nutrition: { ...N, kcal: 1700 }, meals: [planMeal("lunch"), planMeal("dinner")] },
    { day: 2, nutrition: { ...N, kcal: 1200 }, meals: [
      planMeal("lunch", { kind: "leftovers", from_day: 1, from_meal: "dinner", recipe: card(2) }),
      planMeal("dinner", { kind: "eating_out", out_kcal: null, recipe: null }),
    ] },
  ],
}
