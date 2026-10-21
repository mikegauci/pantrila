import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000007"

const steps = ["Preheat the oven to 350°F (180°C).", "Bake 25 minutes until a probe reads 165°F."]

const recipe = {
  id: 1, title: "Imported Brownies", summary: "Fudgy.", cuisine: "american", meal_types: ["dessert"],
  total_minutes: 40, servings: 4, source: "post", source_url: null, source_platform: "instagram",
  source_author: null, recipe_url: null, created_at: "2026-10-20T10:00:00Z", updated_at: "2026-10-20T10:00:00Z",
  ingredient_count: 0, nutrition: null, allergens: [], diet_tags: [], estimated: false, invalid: [],
  pantry_foods: [], problems: [], photo_url: null, ingredients: [], steps,
  recipe: {
    title: "Imported Brownies", summary: "Fudgy.", cuisine: "american", meal_types: ["dessert"],
    total_minutes: 40, servings: 4, ingredients: [], steps, source: "post", source_url: null,
    source_platform: "instagram", source_author: null, recipe_url: null,
  },
}

test("temperatures switch between °C and °F, ovens show the fan setting, and the choice is remembered", async ({ page }) => {
  await page.addInitScript((user) => localStorage.setItem(`pantrila-tour-done:${user}`, "1"), id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path === "/me/recipes/1" ? recipe
      : path === "/me/profile" ? { allergies: [], diets: [] }
      : path === "/me" ? { id, email: null, anonymous: true, avatar_url: null, limits: {} }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })

  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.waitForURL("http://127.0.0.1:3100/")
  await page.goto("/recipes/mine/1")

  await expect(page.getByText("Preheat the oven to 180°C (165°C fan).")).toBeVisible()
  await expect(page.getByText("a probe reads 74°C.")).toBeVisible()

  await page.getByRole("button", { name: "°F" }).click()
  await expect(page.getByText("Preheat the oven to 350°F (325°F fan).")).toBeVisible()
  await expect(page.getByText("a probe reads 165°F.")).toBeVisible()

  await page.reload()
  await expect(page.getByRole("button", { name: "°F" })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByText("Preheat the oven to 350°F (325°F fan).")).toBeVisible()
})
