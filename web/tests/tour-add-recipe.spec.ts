import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000008"

for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`the tour shows the ways to add a recipe at ${size.width} px`, async ({ page }) => {
    await page.setViewportSize(size)
    await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
    await page.route("http://127.0.0.1:8000/**", async (route) => {
      const path = new URL(route.request().url()).pathname
      if (path === "/plans/latest") return route.fulfill({ status: 404, json: { detail: "No plan" } })
      const data = path === "/me/profile" ? { allergies: [], diets: [], excluded_foods: [], targets: {} }
        : path === "/recipes/spanish-vegetable-paella" ? { id: "spanish-vegetable-paella", title: "Vegetable Paella",
          summary: "", cuisine: "spanish", meal_types: ["dinner"], diet_tags: ["vegan"], allergens: [], total_minutes: 45,
          servings: 4, nutrition: { kcal: 450, protein_g: 12, carbs_g: 80, fat_g: 9, fibre_g: 8 }, ingredient_count: 1,
          pantry_foods: [], problems: [], photo_url: null,
          ingredients: [{ name: "rice", food: "rice", quantity: 300, unit: "g", grams: 300, in_pantry: false }],
          steps: ["Add the rice and cook for 18 minutes."] }
        : path === "/recipes" ? { query: "", recipes: [], rules: {
          exclude_allergens: [], require_diets: [], max_minutes: null, meal_types: [], cuisines: [], exclude_foods: [] } }
        : path === "/meta" ? { allergens: [], diets: [], cuisines: [], meal_types: ["dinner"], units: ["g"] }
        : path === "/me" ? { id, email: null, anonymous: true, avatar_url: null, limits: { chats_left: 50, imports_left: 20 } }
        : path === "/health" ? { ok: true } : []
      await route.fulfill({ json: data })
    })
    await page.goto("/login")
    await page.getByRole("button", { name: "Try it as a guest" }).click()
    await page.waitForURL("http://127.0.0.1:3100/")
    const tour = page.getByRole("dialog")
    await expect(tour.getByText("Welcome to Pantrila")).toBeVisible()
    for (let i = 0; i < 6; i++) await tour.getByRole("button", { name: /^(Start|Next)$/ }).click()
    await expect(tour.getByText("Add a recipe four ways")).toBeVisible()
    await expect(page).toHaveURL(/\/recipes\/mine\/new/)
    await tour.getByRole("button", { name: /^(Start|Next)$/ }).click()
    await expect(tour.getByText("Save recipes from social posts")).toBeVisible()
    await tour.getByRole("button", { name: /^(Start|Next)$/ }).click()
    await expect(tour.getByText("Cook hands-free")).toBeVisible()
    await expect(page.getByText("Vegetable Paella")).toBeVisible()
    await expect(page).toHaveURL(/\/recipes\/spanish-vegetable-paella\/cook/)
    await tour.getByRole("button", { name: /^(Start|Next)$/ }).click()
    await expect(page).toHaveURL(/\/plan/)
  })
}
