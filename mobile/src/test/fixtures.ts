import type { RecipeCard, RecipeDetail, RecipeList, SearchRules } from "@pantrila/core/types"

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
