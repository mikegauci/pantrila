import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000005"

const recipe = {
  id: "french-mushroom-omelette", title: "Mushroom Omelette", summary: "Quick eggs.", cuisine: "french",
  meal_types: ["breakfast"], diet_tags: ["vegetarian"], allergens: ["eggs", "milk"], total_minutes: 10,
  servings: 1, nutrition: { kcal: 300, protein_g: 20, carbs_g: 2, fat_g: 22, fibre_g: 1 }, ingredient_count: 2,
  pantry_foods: ["egg"], problems: [], photo_url: null,
  ingredients: [
    { name: "eggs", food: "egg", quantity: 3, unit: "piece", grams: 150, in_pantry: true },
    { name: "butter", food: "butter", quantity: 10, unit: "g", grams: 10, in_pantry: false },
  ],
  steps: ["Whisk the eggs.", "Melt the butter and cook the eggs for 2 to 3 minutes until just set."],
}

test("cooking mode walks the steps, rings a timer and logs the cook", async ({ page }) => {
  const posted: unknown[] = []
  await page.clock.install()
  await page.addInitScript((user) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    const sentinel = { released: false, release: async () => {}, addEventListener: () => {} }
    Object.defineProperty(navigator, "wakeLock", { value: { request: async () => sentinel } })
  }, id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const change = { food: "egg", name: "egg", used_g: 300, unit: "piece", before: 6, after: 0 }
    if (path === "/me/cooked" && route.request().method() === "POST") {
      posted.push(route.request().postDataJSON())
      return route.fulfill({ status: 201, json: { pantry: [{ ...change, after: null }], cooked: {
        id: 1, recipe_id: recipe.id, cookbook_id: null, title: recipe.title, servings: 2,
        pantry_updated: true, cooked_at: new Date().toISOString() } } })
    }
    const data = path === "/recipes/french-mushroom-omelette" ? recipe
      : path === "/me/cooked/preview" ? { cooked: null, pantry: [{ ...change, after: null }] }
      : path === "/me/profile" ? { allergies: [], diets: [] }
      : path === "/me" ? { id, email: null, anonymous: true, avatar_url: null, limits: {} }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })

  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.waitForURL("http://127.0.0.1:3100/")
  await page.goto("/recipes/french-mushroom-omelette")
  await page.getByRole("button", { name: "More servings" }).click()
  await page.getByRole("link", { name: "Start cooking" }).first().click()

  const cooking = page.getByRole("region", { name: "Cooking Mushroom Omelette" })
  await expect(cooking.getByText("Screen stays on")).toBeVisible()
  await expect(cooking.getByText("Get your ingredients out")).toBeVisible()
  await cooking.getByRole("checkbox", { name: /6 piece eggs/ }).click()
  await expect(cooking.getByRole("checkbox", { name: /6 piece eggs/ })).toHaveAttribute("aria-checked", "true")

  await cooking.getByRole("button", { name: "Start cooking" }).click()
  await expect(cooking.getByText("Whisk the eggs.")).toBeVisible()
  await cooking.getByRole("button", { name: "Next step" }).click()
  const forStep = cooking.getByRole("group", { name: "Ingredients for this step" })
  await expect(forStep.getByRole("checkbox")).toHaveText(["6 piece eggs", "20 g butter"])
  await cooking.getByRole("button", { name: "Start 2–3 min timer" }).click()
  await expect(cooking.getByRole("timer")).toHaveText("2:00")
  await page.clock.fastForward("02:01")
  await expect(cooking.getByRole("timer")).toHaveText("Time's up")

  await cooking.getByRole("button", { name: "Finish" }).click()
  await expect(cooking.getByText("used up, removed")).toBeVisible()
  await cooking.getByRole("button", { name: "I cooked this" }).click()
  await expect(cooking.getByText("Enjoy your meal")).toBeVisible()
  expect(posted).toEqual([{ recipe_id: recipe.id, servings: 2, update_pantry: true }])

  await cooking.getByRole("link", { name: "Back to the recipe" }).click()
  await expect(page.getByRole("link", { name: "Start cooking" }).first()).toBeVisible()
})
