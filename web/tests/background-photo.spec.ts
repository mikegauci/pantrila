import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const user = "00000000-0000-4000-8000-000000000017"
const recipe = {
  title: "Lentil soup", summary: "A soup.", cuisine: "", meal_types: ["dinner"], total_minutes: 30,
  servings: 2, steps: ["Simmer."], source: "manual", source_url: null,
  ingredients: [{ name: "lentils", food: "lentils", quantity: 100, unit: "g", estimate: null }],
}

test("a reload while the photo is made keeps the placeholder until the photo lands", async ({ page }) => {
  let reads = 0
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript((id) => {
    localStorage.setItem(`pantrila-tour-done:${id}`, "1")
    localStorage.setItem(`pantrila-replay:${id}`, "off")
    if (!sessionStorage.getItem("pantrila-photo-jobs")) {
      sessionStorage.setItem("pantrila-photo-jobs", JSON.stringify({ 5: Date.now() }))
    }
  }, user)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(user) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/me/recipes/5") reads += 1
    const now = new Date().toISOString()
    const detail = { ...recipe, id: 5, recipe, created_at: now, updated_at: now, ingredient_count: 1,
      nutrition: { kcal: 300, protein_g: 20, carbs_g: 50, fat_g: 2, fibre_g: 10 }, allergens: [],
      diet_tags: ["vegan"], estimated: false, invalid: [], pantry_foods: [], problems: [],
      photo_url: reads > 3 ? "http://127.0.0.1:54321/storage/v1/object/public/recipe-photos/5.webp" : null,
      ingredients: recipe.ingredients.map((line) => ({ ...line, grams: 100, in_pantry: false })),
    }
    const data = path === "/me" ? { id: user, email: null, avatar_url: null, anonymous: true,
      limits: { photos_left: 4, photos_per_day: 5 } }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [],
        days: 7, meals: ["dinner"], max_minutes: null, cuisines: [], notes: "", targets: {} }
      : path === "/me/recipes/5" ? detail
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).not.toHaveURL(/login/)
  await page.goto("/recipes/mine/5")
  const making = page.getByRole("status").filter({ hasText: "Making the photo…" })
  await expect(making).toBeVisible()
  await page.screenshot({ path: "test-results/background-photo-making.png" })
  await expect(page.getByRole("heading", { name: "Lentil soup" })).toBeVisible()
  await expect(making).toHaveCount(0)
  await expect(page.getByRole("button", { name: "New photo" })).toBeEnabled()
  expect(reads).toBeGreaterThan(3)
})
