import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000007"

const recipe = {
  id: "red-velvet-cookies", title: "Red Velvet Cookies", summary: "Soft cookies.", cuisine: "american",
  meal_types: ["snack"], diet_tags: ["vegetarian"], allergens: ["gluten"], total_minutes: 30,
  servings: 12, nutrition: { kcal: 150, protein_g: 2, carbs_g: 20, fat_g: 7, fibre_g: 1 }, ingredient_count: 1,
  pantry_foods: [], problems: [], photo_url: null,
  ingredients: [{ name: "flour", food: "wheat_flour", quantity: 200, unit: "g", grams: 200, in_pantry: false }],
  steps: [
    "Preheat the oven to 180°C. Line a tray.",
    "Roll the dough into balls.",
    "Place on the tray. Bake at 180°C for 9-12 minutes. Cool on the tray.",
  ],
}

test("a preheat step in cooking mode shows the bake sentence on hover, not on the recipe page", async ({ page }) => {
  await page.addInitScript((user) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    const sentinel = { released: false, release: async () => {}, addEventListener: () => {} }
    Object.defineProperty(navigator, "wakeLock", { value: { request: async () => sentinel } })
  }, id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path === `/recipes/${recipe.id}` ? recipe
      : path === "/me/profile" ? { allergies: [], diets: [] }
      : path === "/me" ? { id, email: null, anonymous: true, avatar_url: null, limits: {} }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })

  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.waitForURL("http://127.0.0.1:3100/")
  await page.goto(`/recipes/${recipe.id}`)
  await expect(page.getByText("Line a tray.", { exact: false })).toBeVisible()
  await expect(page.getByText("Coming up in step")).toHaveCount(0)
  await page.getByRole("link", { name: "Start cooking" }).first().click()

  const cooking = page.getByRole("region", { name: "Cooking Red Velvet Cookies" })
  await cooking.getByRole("button", { name: "Start cooking" }).click()
  const trigger = cooking.getByRole("button", { name: "Preheat the oven" })
  await trigger.hover()
  await expect(page.getByText("Shown in Step 3: Bake at 180°C (165°C fan) for 9-12 minutes.")).toBeVisible()
})
