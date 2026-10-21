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

test("a post imports from its link and keeps the credit", async ({ page }) => {
  const imports: { id?: string; kind?: string; url?: string; caption?: string | null }[] = []
  let saved = draft
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript((user) => localStorage.setItem(`pantrila-tour-done:${user}`, "1"), id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const now = new Date().toISOString()
    if (path === "/me/recipes/import/jobs") {
      const body = route.request().postDataJSON()
      imports.push(body)
      return route.fulfill({ status: 202, json: { id: body.id, status: "running", result: null, error: null } })
    }
    if (path.startsWith("/me/recipes/import/jobs/")) {
      const jobId = path.split("/").pop()
      if (jobId === imports[0]?.id) {
        return route.fulfill({ json: { id: jobId, status: "failed", result: null, error: { status: 422,
          message: "Instagram didn't let Pantrila read this post. Try another public recipe link." } } })
      }
      return route.fulfill({ json: { id: jobId, status: "done", error: null,
        result: { draft, notes: [], cost_usd: 0.004, latency_ms: 5000 } } })
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
      : path === "/me/recipes/9" || path === "/me/recipes/9/photo" || path === "/me/recipes" && route.request().method() === "POST" ? detail
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

  await expect(page.getByRole("alert").filter({ hasText: "Instagram didn't let Pantrila read this post" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Paste the caption" })).toHaveCount(0)
  await expect(page.getByLabel("Caption", { exact: true })).toHaveCount(0)
  await expect(page.getByPlaceholder("Paste Instagram, Facebook or TikTok link")).toBeVisible()
  await expect(page.getByText("Pantrila reads the recipe from your post and credits the creator.")).toBeVisible()
  await page.getByRole("button", { name: "Read recipe" }).click()

  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Crispy gnocchi")
  expect(imports.at(-1)).toMatchObject({ kind: "post", url: post })
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

test("where the service covers the platform, Pantrila says it is listening to the video", async ({ page }) => {
  const heard = "Pantrila listened to the post's video for this recipe. Check the amounts and steps."
  let released = false
  await page.clock.install()
  await page.addInitScript((user) => localStorage.setItem(`pantrila-tour-done:${user}`, "1"), id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/me/recipes/import/jobs") {
      return route.fulfill({ status: 202, json: { id: "job-1", status: "running", result: null, error: null } })
    }
    if (path.startsWith("/me/recipes/import/jobs/")) {
      if (!released) return route.fulfill({ json: { id: "job-1", status: "running", result: null, error: null } })
      return route.fulfill({ json: { id: "job-1", status: "done", error: null, result: {
        draft: { ...draft, recipe_url: null }, notes: [heard],
        cost_usd: 0.012, media_cost_usd: 0.003, transcription_cost_usd: 0.001, latency_ms: 30000 } } })
    }
    const data = path === "/me" ? { id, email: null, avatar_url: null, anonymous: true,
      limits: { imports_left: 9, imports_per_day: 10, photos_left: 5, photos_per_day: 5 } }
      : path === "/me/recipes/import/timing" ? { estimated_seconds: 90, sample_count: 2 }
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
  const timingLoaded = page.waitForResponse("**/me/recipes/import/timing")
  await page.getByRole("button", { name: /From a post/ }).click()
  await timingLoaded
  await page.getByLabel("Post link").fill(post)
  await expect(page.getByText("Pantrila reads the recipe from your post and credits the creator.")).toBeVisible()
  await page.clock.pauseAt(new Date(Date.now() + 5000))
  await page.getByRole("button", { name: "Read recipe" }).click()
  await expect(page.getByRole("button", { name: "Reading the post…" })).toBeVisible()
  await expect(page.getByRole("timer")).toHaveText("Estimated time remaining: 1:30")
  await page.clock.fastForward(9000)
  await expect(page.getByText("Reading the post and its video…", { exact: true })).toBeVisible()
  await expect(page.getByRole("timer")).toHaveText("Estimated time remaining: 1:21")
  await page.clock.fastForward(100000)
  await expect(page.getByText("Taking longer than usual. Still working…")).toBeVisible()
  await expect(page.getByRole("timer")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Upload the video" })).toHaveCount(0)
  released = true
  await page.clock.fastForward(2500)
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Crispy gnocchi")
  await expect(page.getByText(heard)).toBeHidden()
  await page.getByText("1 note to check").click()
  await expect(page.getByText(heard)).toBeVisible()

  await page.goto("/recipes/mine/new")
  await page.getByRole("button", { name: /From a post/ }).click()
  await page.getByLabel("Post link").fill("https://www.tiktok.com/@sam/video/7300000000000000001")
  await expect(page.getByLabel("Caption", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Paste the caption" })).toHaveCount(0)
})
