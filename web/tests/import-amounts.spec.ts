import { expect, test } from "@playwright/test"

import { session } from "./helpers"

import type { CookbookRecipeIn } from "../src/lib/types"

const user = "00000000-0000-4000-8000-000000000016"
const nutrition = { kcal: 420, protein_g: 14, carbs_g: 65, fat_g: 12, fibre_g: 3 }
const initial: CookbookRecipeIn = {
  title: "Basil pasta", summary: "A pasta bake.", cuisine: "italian", meal_types: ["dinner"],
  total_minutes: 40, servings: 4, steps: ["Cook and bake."], source: "post",
  source_url: "https://www.instagram.com/reel/C1abc/", source_platform: "instagram",
  source_author: null, recipe_url: null,
  ingredients: [
    { name: "1 sprig basil leaves", food: "basil", quantity: 2, unit: "g", estimate: null,
      amount_estimate: "A typical basil sprig weighs about 2 g." },
    { name: "pasta", food: "pasta", quantity: 300, unit: "g", estimate: null,
      amount_estimate: "Estimated 75 g dry pasta per serving." },
  ],
}

test("estimated import saves without manual fixes and retains its nutrition notes", async ({ page }) => {
  let saved = structuredClone(initial)
  let writes = 0
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript((id) => localStorage.setItem(`pantrio-tour-done:${id}`, "1"), user)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(user) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().method() === "POST" || route.request().method() === "PUT"
      ? route.request().postDataJSON() : null
    if ((path === "/me/recipes" && body) || (path === "/me/recipes/9" && body)) {
      saved = body
      writes += 1
    }
    const estimated = saved.ingredients.some((line) => line.amount_estimate)
    const detail = { ...saved, id: 9, recipe: saved, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), ingredient_count: 2, nutrition,
      allergens: ["gluten"], diet_tags: ["vegetarian"], estimated, invalid: [], pantry_foods: [],
      problems: [], photo_url: null,
      ingredients: saved.ingredients.map((line) => ({ ...line, grams: line.quantity, in_pantry: false })),
    }
    const data = path === "/me" ? { id: user, email: null, avatar_url: null, anonymous: true,
      limits: { imports_left: 9, imports_per_day: 10, photos_left: 5, photos_per_day: 5 } }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [],
        days: 7, meals: ["dinner"], max_minutes: null, cuisines: [], notes: "", targets: {} }
      : path === "/foods" ? ["basil", "pasta"].map((key) => ({ key, name: key, aisle: "other" }))
      : path === "/me/recipes/import/post" ? { draft: initial, notes: [], cost_usd: 0.005, latency_ms: 1000 }
      : path === "/me/recipes/preview" ? { ingredients: [], nutrition, allergens: ["gluten"],
        diet_tags: ["vegetarian"], estimated: body.ingredients.some((line: { amount_estimate?: string }) => line.amount_estimate), problems: [] }
      : path === "/me/recipes/9" || (path === "/me/recipes" && body) ? detail
      : path === "/me/recipes" ? writes ? [detail] : []
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).not.toHaveURL(/login/)
  await page.goto("/recipes/mine/new")
  await page.getByRole("button", { name: /From a post/ }).click()
  await page.getByLabel("Post link").fill(initial.source_url!)
  await page.getByRole("button", { name: "Read recipe" }).click()
  await expect(page.getByText("A typical basil sprig weighs about 2 g.").filter({ visible: true })).toBeVisible()
  await expect(page.getByText("Estimated nutrition", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText("To fix before saving")).toHaveCount(0)
  await page.getByRole("button", { name: "Save to my recipes", exact: true }).click()
  await expect(page).toHaveURL(/\/recipes\/mine\/9$/)
  expect(writes).toBe(1)
  expect(saved.ingredients[0].amount_estimate).toBe(initial.ingredients[0].amount_estimate)
  await expect(page.getByText("Estimated nutrition", { exact: true }).filter({ visible: true })).toBeVisible()
  await expect(page.getByText("Estimated amount: A typical basil sprig weighs about 2 g.")).toBeVisible()
  await page.screenshot({ path: "test-results/estimated-recipe-mobile.png", fullPage: true })

  await page.getByRole("button", { name: "Edit", exact: true }).click()
  await page.getByRole("spinbutton", { name: "Amount for ingredient 1", exact: true }).fill("3")
  await expect(page.getByText("A typical basil sprig weighs about 2 g.").filter({ visible: true })).toHaveCount(0)
  await expect(page.getByText("Estimated 75 g dry pasta per serving.").filter({ visible: true })).toBeVisible()
})
