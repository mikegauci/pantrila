import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000017"
const post = "https://www.instagram.com/reel/C1abc/"
const nutrition = { kcal: 300, protein_g: 12, carbs_g: 40, fat_g: 10, fibre_g: 2 }
const draft = {
  title: "Crispy gnocchi", summary: "Pan-fried gnocchi.", cuisine: "italian", meal_types: ["dinner"],
  total_minutes: 15, servings: 2,
  ingredients: [{ name: "500 g gnocchi", food: "gnocchi", quantity: 500, unit: "g", estimate: null }],
  steps: ["Fry the gnocchi."], source: "post", source_url: post, source_platform: "instagram",
  source_author: null, recipe_url: null,
}
const running = { id: "job-1", status: "running", result: null, error: null }
const done = { id: "job-1", status: "done", error: null, result: { draft, notes: [], cost_usd: 0.004, latency_ms: 5000 } }

test("an import survives a dropped connection and a page reload", async ({ page }) => {
  let polls = 0
  let finished = false
  let starts = 0
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript((user) => localStorage.setItem(`pantrila-tour-done:${user}`, "1"), id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/me/recipes/import/jobs") {
      starts += 1
      return route.fulfill({ status: 202, json: running })
    }
    if (path.startsWith("/me/recipes/import/jobs/")) {
      polls += 1
      if (polls === 1) return route.abort("connectionreset") // the phone just woke up
      return route.fulfill({ json: finished ? done : running })
    }
    const data = path === "/me" ? { id, email: null, avatar_url: null, anonymous: true,
      limits: { imports_left: 9, imports_per_day: 10, photos_left: 5, photos_per_day: 5 } }
      : path === "/meta" ? { allergens: [], diets: [], meal_types: ["dinner"], units: ["g"], cuisines: [], reel_platforms: [] }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [],
        days: 7, meals: ["dinner"], max_minutes: null, cuisines: [], notes: "", targets: {} }
      : path === "/foods" ? [{ key: "gnocchi", name: "gnocchi", aisle: "pasta" }]
      : path === "/me/recipes/preview" ? { ingredients: [], nutrition, allergens: ["gluten"],
        diet_tags: ["vegetarian"], estimated: false, problems: [] }
      : path === "/plans/latest" ? null
      : path === "/health" ? { ok: true } : []
    if (data === null) return route.fulfill({ status: 404, json: {} })
    await route.fulfill({ json: data })
  })

  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).not.toHaveURL(/login/)
  await page.goto("/recipes/mine/new")
  await page.getByRole("button", { name: /From a post/ }).click()
  await page.getByLabel("Post link").fill(post)
  await page.getByRole("button", { name: "Read recipe" }).click()

  // The first poll is lost; the import is not reported as failed.
  await expect.poll(() => polls, { timeout: 10000 }).toBeGreaterThanOrEqual(2)
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Reading the post…" })).toBeVisible()

  // Leave the page while the server is still working, then come back.
  await page.reload()
  await expect(page.getByText("Finishing your import…")).toBeVisible()
  finished = true
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Crispy gnocchi", { timeout: 10000 })
  expect(starts).toBe(1)

  // Once delivered, the job is forgotten: another visit does not wait for it.
  await page.reload()
  await expect(page.getByText("Finishing your import…")).toHaveCount(0)
})

test("a resumed import can be abandoned, and a newer import keeps its saved id", async ({ page }) => {
  const key = `pantrila-import-job:${id}`
  let finished = false
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(([user, storageKey]) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    if (!localStorage.getItem(storageKey)) localStorage.setItem(storageKey, JSON.stringify({ id: "old", at: Date.now() }))
  }, [id, key])
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path.startsWith("/me/recipes/import/jobs/")) {
      return route.fulfill({ json: finished ? done : running })
    }
    const data = path === "/me" ? { id, email: null, avatar_url: null, anonymous: true,
      limits: { imports_left: 9, imports_per_day: 10, photos_left: 5, photos_per_day: 5 } }
      : path === "/meta" ? { allergens: [], diets: [], meal_types: ["dinner"], units: ["g"], cuisines: [], reel_platforms: [] }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [],
        days: 7, meals: ["dinner"], max_minutes: null, cuisines: [], notes: "", targets: {} }
      : path === "/foods" ? [] : path === "/plans/latest" ? null
      : path === "/health" ? { ok: true } : []
    if (data === null) return route.fulfill({ status: 404, json: {} })
    await route.fulfill({ json: data })
  })

  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).not.toHaveURL(/login/)
  await page.goto("/recipes/mine/new")
  await expect(page.getByText("Finishing your import…")).toBeVisible()
  await page.getByRole("button", { name: "Stop waiting" }).click()
  await expect(page.getByText("Finishing your import…")).toHaveCount(0)
  finished = true
  await page.waitForTimeout(3000)
  await expect(page.getByLabel("Title", { exact: true })).toHaveCount(0)
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBeNull()
})
