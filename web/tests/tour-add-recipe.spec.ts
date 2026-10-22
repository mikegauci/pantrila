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
    await expect(page).toHaveURL(/\/recipes$/)
    await tour.getByRole("button", { name: /^(Start|Next)$/ }).click()
    await expect(page).toHaveURL(/\/plan/)
  })
}
