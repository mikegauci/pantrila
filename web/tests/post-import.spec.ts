import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000006"
const post = "https://www.instagram.com/reel/C1abc/"
const nutrition = { kcal: 300, protein_g: 12, carbs_g: 40, fat_g: 10, fibre_g: 2 }
const draft = {
  title: "Crispy gnocchi", summary: "Pan-fried gnocchi.", cuisine: "italian", meal_types: ["dinner"],
  total_minutes: 15, servings: 2,
  ingredients: [{ name: "500 g gnocchi", food: "gnocchi", quantity: 500, unit: "g", estimate: null }],
  steps: ["Fry the gnocchi."], source: "post", source_url: post, source_platform: "instagram",
  source_author: null, recipe_url: "https://sambakes.com/gnocchi",
}

test("a post that can't be read asks for its caption and keeps the credit", async ({ page }) => {
  const imports: { url?: string; caption?: string | null }[] = []
  let saved = draft
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript((user) => localStorage.setItem(`pantrio-tour-done:${user}`, "1"), id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const now = new Date().toISOString()
    if (path === "/me/recipes/import/post") {
      const body = route.request().postDataJSON()
      imports.push(body)
      if (!body.caption) {
        return route.fulfill({ status: 422,
          json: { detail: "Instagram didn't let Pantrio read this post. Paste the caption below." } })
      }
      return route.fulfill({ json: { draft, notes: [], cost_usd: 0.004, latency_ms: 5000 } })
    }
    if (path === "/me/recipes" && route.request().method() === "POST") saved = route.request().postDataJSON()
    const detail = { ...saved, id: 9, recipe: saved, created_at: now, updated_at: now,
      ingredient_count: 1, nutrition, allergens: ["gluten"], diet_tags: ["vegetarian"],
      estimated: false, invalid: [], pantry_foods: [], problems: [], photo_url: null,
      ingredients: saved.ingredients.map((line) => ({ ...line, grams: 500, in_pantry: false })),
    }
    const data = path === "/me" ? { id, email: null, avatar_url: null, anonymous: true,
      limits: { imports_left: 9, imports_per_day: 10, photos_left: 5, photos_per_day: 5 } }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [],
        days: 7, meals: ["dinner"], max_minutes: null, cuisines: [], notes: "", targets: {} }
      : path === "/foods" ? [{ key: "gnocchi", name: "gnocchi", aisle: "pasta" }]
      : path === "/me/recipes/preview" ? { ingredients: [], nutrition, allergens: ["gluten"],
        diet_tags: ["vegetarian"], estimated: false, problems: [] }
      : path === "/me/recipes/9" || path === "/me/recipes" && route.request().method() === "POST" ? detail
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

  await expect(page.getByRole("alert").filter({ hasText: "Instagram didn't let Pantrio read this post" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Add screenshots instead" })).toBeVisible()
  const caption = page.getByLabel("Caption", { exact: true })
  await expect(caption).toBeFocused()
  await page.screenshot({ path: "test-results/post-import-caption.png", fullPage: true })
  await caption.fill("Crispy gnocchi 🥔 full recipe sambakes.com/gnocchi")
  await page.getByRole("button", { name: "Read recipe" }).click()

  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Crispy gnocchi")
  expect(imports.at(-1)).toEqual({ url: post, caption: "Crispy gnocchi 🥔 full recipe sambakes.com/gnocchi" })
  await page.getByLabel("Creator").fill("@sam.cooks")
  await expect(page.getByLabel("Posted on")).toHaveValue("instagram")
  await page.getByLabel("Creator").scrollIntoViewIfNeeded()
  await page.screenshot({ path: "test-results/post-import-credit.png" })
  await page.getByRole("button", { name: "Save to my recipes", exact: true }).click()

  await expect(page).toHaveURL(/\/recipes\/mine\/9$/)
  expect(saved.source_author).toBe("sam.cooks")
  await expect(page.getByRole("link", { name: "From @sam.cooks on Instagram" })).toHaveAttribute("href", post)
  await expect(page.getByRole("link", { name: "sambakes.com" })).toHaveAttribute("href", "https://sambakes.com/gnocchi")
  await page.screenshot({ path: "test-results/post-import-recipe.png", fullPage: true })
})

test("where the service covers the platform, Pantrio says it is listening to the video", async ({ page }) => {
  const heard = "Pantrio listened to the post's video for this recipe. Check the amounts and steps."
  let answer: () => void = () => {}
  const answered = new Promise<void>((resolve) => { answer = resolve })
  await page.clock.install()
  await page.addInitScript((user) => localStorage.setItem(`pantrio-tour-done:${user}`, "1"), id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/me/recipes/import/post") {
      await answered
      return route.fulfill({ json: { draft: { ...draft, recipe_url: null }, notes: [heard],
        cost_usd: 0.012, media_cost_usd: 0.003, transcription_cost_usd: 0.001, latency_ms: 30000 } })
    }
    const data = path === "/me" ? { id, email: null, avatar_url: null, anonymous: true,
      limits: { imports_left: 9, imports_per_day: 10, photos_left: 5, photos_per_day: 5 } }
      : path === "/meta" ? { allergens: [], diets: [], meal_types: ["dinner"], units: ["g"], cuisines: [],
        reel_platforms: ["instagram"] }
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
  await expect(page.getByText(/it listens to the video too/)).toBeVisible()
  await page.getByRole("button", { name: "Read recipe" }).click()
  await expect(page.getByRole("button", { name: "Reading the caption…" })).toBeVisible()
  await page.clock.fastForward(9000)
  await expect(page.getByRole("button", { name: "Listening to the video…" })).toBeVisible()
  answer()
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Crispy gnocchi")
  await expect(page.getByText(heard)).toBeVisible()

  await page.goto("/recipes/mine/new")
  await page.getByRole("button", { name: /From a post/ }).click()
  await page.getByLabel("Post link").fill("https://www.tiktok.com/@sam/video/7300000000000000001")
  await expect(page.getByText(/it listens to the video too/)).toHaveCount(0)
})
