import { expect, test } from "@playwright/test"

import { session } from "./helpers"

import type { CookbookRecipeIn } from "../src/lib/types"

const user = "00000000-0000-4000-8000-000000000018"
const nutrition = { kcal: 420, protein_g: 30, carbs_g: 50, fat_g: 12, fibre_g: 2 }
// An older import: each name still starts with the source's amount.
const lines = [
  { name: "1 cup basmati rice", food: "basmati_rice", quantity: 1, unit: "cup", grams: 185, grams_per_ml: 0.77, grams_per_piece: null },
  { name: "1 pound chicken thighs", food: "chicken_thigh", quantity: 454, unit: "g", grams: 454, grams_per_ml: null, grams_per_piece: 113 },
  { name: "1-1/4 teaspoons paprika", food: "paprika", quantity: 1.25, unit: "tsp", grams: 2.9, grams_per_ml: 0.46, grams_per_piece: null },
  { name: "1/2 teaspoon oregano", food: "oregano", quantity: 0.5, unit: "tsp", grams: 0.5, grams_per_ml: 0.2, grams_per_piece: null },
] as const
const recipe: CookbookRecipeIn = {
  title: "Chicken rice", summary: "", cuisine: "", meal_types: ["dinner"], total_minutes: 40, servings: 4,
  source: "link", source_url: "https://example.com/rice", source_platform: null, source_author: null, recipe_url: null,
  ingredients: lines.map(({ name, food, quantity, unit }) => ({ name, food, quantity, unit, estimate: null })),
  steps: ["Cook."], step_sections: [],
}

test("amounts show once, US measures as fractions, and a line can be shown in another unit", async ({ page }) => {
  await page.addInitScript((id) => localStorage.setItem(`pantrila-tour-done:${id}`, "1"), user)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(user) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path === "/me" ? { id: user, email: null, avatar_url: null, anonymous: true,
      limits: { imports_left: 9, imports_per_day: 10, photos_left: 5, photos_per_day: 5 } }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [],
        days: 7, meals: ["dinner"], max_minutes: null, cuisines: [], notes: "", targets: {} }
      : path === "/me/recipes/7" ? { ...recipe, id: 7, recipe, created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(), ingredient_count: 4, nutrition, allergens: [], diet_tags: [],
        estimated: false, invalid: [], pantry_foods: [], problems: [], photo_url: null,
        ingredients: lines.map((l) => ({ ...l, estimate: null, in_pantry: false })) }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).not.toHaveURL(/login/)
  await page.goto("/recipes/mine/7")

  const list = page.getByRole("list").filter({ hasText: "basmati rice" })
  await expect(list).toContainText("1 cup basmati rice")
  await expect(list).not.toContainText("1 cup 1 cup")
  await expect(list).toContainText("454 g chicken thighs")
  await expect(list).toContainText("1 1/4 tsp paprika")
  await expect(list).toContainText("1/2 tsp oregano")

  await page.getByRole("button", { name: "454 g chicken thighs: show in another unit" }).click()
  await page.getByRole("menuitemradio", { name: "1 lb" }).click()
  await expect(page.getByRole("button", { name: "1 lb chicken thighs: show in another unit" })).toBeVisible()

  await page.getByRole("button", { name: "1 cup basmati rice: show in another unit" }).click()
  await expect(page.getByRole("menuitemradio", { name: "1 cup (recipe)" })).toBeChecked()
  await page.getByRole("menuitemradio", { name: "185 g" }).click()
  await expect(list).toContainText("185 g basmati rice")
})
