import { expect, type Page, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000011"

function card(n: number, title: string) {
  const now = new Date().toISOString()
  return { id: n, title, summary: "", cuisine: "italian", meal_types: ["dinner"], total_minutes: 20 + n,
    servings: 2, source: "post", source_url: null, source_platform: "instagram", source_author: null,
    recipe_url: null, chat_draft: null, created_at: now, updated_at: now, ingredient_count: 3,
    nutrition: { kcal: 400, protein_g: 20, carbs_g: 40, fat_g: 12, fibre_g: 3 }, allergens: [],
    diet_tags: [], estimated: false, invalid: [], pantry_foods: [], problems: [], photo_url: null }
}

async function signIn(page: Page, cookbook: unknown[]) {
  await page.addInitScript((user) => localStorage.setItem(`pantrila-tour-done:${user}`, "1"), id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path === "/me" ? { id, email: null, avatar_url: null, anonymous: true,
      limits: { imports_left: 9, imports_per_day: 10, photos_left: 5, photos_per_day: 5 } }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [],
        days: 7, meals: ["dinner"], max_minutes: null, cuisines: [], notes: "", targets: {} }
      : path === "/me/recipes" ? cookbook
      : path === "/plans/latest" ? null
      : path === "/health" ? { ok: true } : []
    if (data === null) return route.fulfill({ status: 404, json: {} })
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).not.toHaveURL(/login/)
}

test("home pitches importing a recipe and opens the post import", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await signIn(page, [])
  await page.goto("/")

  const section = page.locator('[data-tour="my-recipes-home"]')
  await expect(section.getByText(/Saw a recipe on TikTok, Instagram or Facebook/)).toBeVisible()
  await expect(section.getByRole("link", { name: "See all" })).toHaveCount(0)
  await section.getByRole("link", { name: "Import from a post" }).click()

  await expect(page).toHaveURL(/\/recipes\/mine\/new$/)
  await expect(page.getByRole("button", { name: /From a post/ })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByLabel("Post link")).toBeVisible()
})

test("home shows the latest saved recipes and opens the link import", async ({ page }) => {
  await signIn(page, [card(5, "Crispy gnocchi"), card(4, "Miso salmon"), card(3, "Dal"),
    card(2, "Shakshuka"), card(1, "Old soup")])
  await page.goto("/")

  const section = page.locator('[data-tour="my-recipes-home"]')
  await expect(section.getByText("5 saved")).toBeVisible()
  await expect(section.getByRole("link", { name: /Crispy gnocchi/ })).toHaveAttribute("href", "/recipes/mine/5")
  await expect(section.getByText("Shakshuka")).toBeVisible()
  await expect(section.getByText("Old soup")).toHaveCount(0)
  await expect(section.getByRole("link", { name: "See all" })).toHaveAttribute("href", "/recipes/mine")
  await section.getByRole("link", { name: "From a recipe link" }).click()

  await expect(page.getByRole("button", { name: /From a link/ })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByLabel("Recipe link")).toBeVisible()
})
