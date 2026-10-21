import { expect, test } from "@playwright/test"

import { session } from "./helpers"

import type { CookbookRecipeIn } from "../src/lib/types"

const user = "00000000-0000-4000-8000-000000000017"
const nutrition = { kcal: 420, protein_g: 14, carbs_g: 65, fat_g: 12, fibre_g: 3 }
const line = (name: string, food: string, section: string) =>
  ({ name, food, quantity: 100, unit: "g" as const, estimate: null, section })
const draft: CookbookRecipeIn = {
  title: "Chicken broth bowl", summary: "Rice, chicken and broth.", cuisine: "thai",
  meal_types: ["dinner"], total_minutes: 40, servings: 4, source: "link",
  source_url: "https://example.com/bowl", source_platform: null, source_author: null,
  recipe_url: null,
  ingredients: [
    line("1 cup basmati rice", "basmati_rice", "Rice & Chicken"),
    line("1 pound chicken thighs", "chicken_thigh", "Rice & Chicken"),
    line("1 can coconut milk", "coconut_milk", "Broth"),
  ],
  steps: ["Bake the chicken.", "Boil the rice.", "Simmer the broth."],
  step_sections: [{ title: "Chicken", first_step: 1 }, { title: "Broth", first_step: 3 }],
}

test("an imported recipe keeps its ingredient groups and method headings through save and edit", async ({ page }) => {
  let saved: CookbookRecipeIn | null = null
  await page.addInitScript((id) => localStorage.setItem(`pantrila-tour-done:${id}`, "1"), user)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(user) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    const body = method === "POST" || method === "PUT"
      ? route.request().postData() ? route.request().postDataJSON() : null : null
    if ((path === "/me/recipes" || path === "/me/recipes/7") && body) saved = body
    const recipe = saved ?? draft
    const detail = { ...recipe, id: 7, recipe, created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(), ingredient_count: 3, nutrition,
      allergens: [], diet_tags: [], estimated: false, invalid: [], pantry_foods: [],
      problems: [], photo_url: null,
      ingredients: recipe.ingredients.map((l) => ({ ...l, grams: l.quantity, in_pantry: false })),
      step_sections: recipe.step_sections ?? [],
    }
    const data = path === "/me" ? { id: user, email: null, avatar_url: null, anonymous: true,
      limits: { imports_left: 9, imports_per_day: 10, photos_left: 5, photos_per_day: 5 } }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [],
        days: 7, meals: ["dinner"], max_minutes: null, cuisines: [], notes: "", targets: {} }
      : path === "/foods" ? ["basmati_rice", "chicken_thigh", "coconut_milk"].map((key) => ({ key, name: key, aisle: "other" }))
      : path.startsWith("/me/recipes/import/jobs") ? { id: "job-1", status: "done", error: null,
        result: { draft, notes: [], cost_usd: 0.005, latency_ms: 1000 } }
      : path === "/me/recipes/preview" ? { ingredients: [], nutrition, allergens: [], diet_tags: [], estimated: false, problems: [] }
      : path === "/me/recipes/7" || path === "/me/recipes/7/photo" || ((path === "/me/recipes" || path === "/me/recipes/7") && body) ? detail
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).not.toHaveURL(/login/)
  await page.goto("/recipes/mine/new")
  await page.getByRole("button", { name: /From a link/ }).click()
  await page.getByLabel("Recipe link").fill(draft.source_url!)
  await page.getByRole("button", { name: "Read recipe" }).click()

  // The import is saved as read, then the form keeps the groups when editing.
  await expect(page).toHaveURL(/\/recipes\/mine\/7$/)
  expect(saved!.ingredients.map((l) => l.section)).toEqual(["Rice & Chicken", "Rice & Chicken", "Broth"])
  expect(saved!.step_sections).toEqual(draft.step_sections)
  await page.getByRole("button", { name: "Edit", exact: true }).click()
  await expect(page.getByLabel("Group name, Rice & Chicken")).toBeVisible()
  await expect(page.getByLabel("Group name, Broth")).toBeVisible()
  await expect(page.getByLabel("Group name, Optional toppings")).toHaveCount(0)
  await expect(page.locator("#steps")).toHaveValue(
    "## Chicken\n\nBake the chicken.\n\nBoil the rice.\n\n## Broth\n\nSimmer the broth.")

  await page.getByLabel("Group name, Broth").fill("Coconut broth")
  await page.getByRole("button", { name: "Save changes", exact: true }).click()
  await expect.poll(() => saved!.ingredients[2].section).toBe("Coconut broth")
  expect(saved!.ingredients.map((l) => l.section)).toEqual(["Rice & Chicken", "Rice & Chicken", "Coconut broth"])
  expect(saved!.step_sections).toEqual([{ title: "Chicken", first_step: 1 }, { title: "Broth", first_step: 3 }])
})

test("cooking mode lists the step's own group: one olive oil, and its seasonings", async ({ page }) => {
  const spoon = (name: string, food: string, quantity: number, unit: "tsp" | "tbsp", section: string) =>
    ({ name, food, quantity, unit, estimate: null, section })
  const recipe: CookbookRecipeIn = { ...draft,
    ingredients: [
      line("1 pound chicken thighs", "chicken_thigh", "Rice & Chicken"),
      spoon("olive oil", "olive_oil", 2, "tbsp", "Rice & Chicken"),
      spoon("paprika", "paprika", 1, "tsp", "Rice & Chicken"),
      spoon("oregano", "oregano", 0.5, "tsp", "Rice & Chicken"),
      spoon("olive oil", "olive_oil", 1, "tbsp", "Broth"),
      spoon("curry powder", "curry_powder", 1, "tsp", "Broth"),
    ],
    steps: ["Whisk together olive oil and seasonings, then rub it over each thigh.", "Heat the olive oil and add the curry powder."],
    step_sections: [{ title: "Chicken", first_step: 1 }, { title: "Broth", first_step: 2 }],
  }
  await page.addInitScript((id) => localStorage.setItem(`pantrila-tour-done:${id}`, "1"), user)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(user) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const data = path === "/me/recipes/7" ? { ...recipe, id: 7, recipe, nutrition, allergens: [], diet_tags: [],
      estimated: false, invalid: [], pantry_foods: [], problems: [], photo_url: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ingredient_count: 6,
      ingredients: recipe.ingredients.map((l) => ({ ...l, grams: 10, in_pantry: false })) }
      : path === "/me" ? { id: user, email: null, avatar_url: null, anonymous: true, limits: {} }
      : path === "/me/profile" ? { allergies: [], diets: [] }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).not.toHaveURL(/login/)
  await page.goto("/recipes/mine/7/cook")

  const cooking = page.getByRole("region", { name: /Cooking/ })
  await cooking.getByRole("button", { name: "Start cooking" }).click()
  const forStep = cooking.getByRole("group", { name: "Ingredients for this step" })
  await expect(forStep.getByRole("checkbox")).toHaveText([/chicken thighs/, /2 tbsp\s*olive oil/, /paprika/, /oregano/])
  await cooking.getByRole("button", { name: "Next step" }).click()
  await expect(forStep.getByRole("checkbox")).toHaveText([/1 tbsp\s*olive oil/, /curry powder/])
})
