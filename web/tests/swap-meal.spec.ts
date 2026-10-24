import { expect, test, type Page } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000021"

test.use({ viewport: { width: 390, height: 844 } })

const nutrition = (kcal: number) => ({ kcal, protein_g: 30, carbs_g: 40, fat_g: 10, fibre_g: 5 })
const card = (rid: string, title: string, kcal: number, pantry: string[] = []) => ({
  id: rid, title, summary: "", cuisine: "greek", meal_types: ["dinner"], diet_tags: [],
  allergens: [], total_minutes: 30, servings: 2, nutrition: nutrition(kcal), ingredient_count: 5,
  pantry_foods: pantry, problems: [], photo_url: null,
})
const CHICKEN = card("chicken", "Lemon Chicken", 600)
const CURRY = card("curry", "Chickpea Curry", 500, ["chickpeas"])
const NOODLES = card("noodles", "Peanut Noodles", 700)

const report = {
  model: "m", warnings: [], first_draft_problems: [], repairs: 0, fallbacks: 0, pantry_use: 1,
  path: [], llm_calls: 1, tool_calls: 1, input_tokens: 1, output_tokens: 1, cost_usd: 0.01,
  latency_ms: 1000,
}
const plan = (dinner: typeof CHICKEN) => ({
  id: 7, created_at: new Date().toISOString(), notes: "", problems: [], report,
  targets: { kcal: null, min_protein_g: null, max_carbs_g: null },
  days: [{ day: 1, nutrition: nutrition(dinner.nutrition.kcal),
    meals: [{ meal_type: "dinner", portions: 1, recipe: dinner, kind: "recipe", cookbook_id: null,
      from_day: null, from_meal: null, out_kcal: null }] }],
})

async function openPlan(page: Page, onSwap: (body: unknown) => { status: number; json: unknown }) {
  let current = CHICKEN
  await page.addInitScript((user) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    localStorage.setItem(`pantrila-replay:${user}`, "off")
  }, id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === "/plans/latest/meals/1/dinner" && request.method() === "PUT") {
      const answer = onSwap(request.postDataJSON())
      if (answer.status === 200) current = CURRY
      return route.fulfill({ status: answer.status, json: answer.status === 200 ? plan(current) : answer.json })
    }
    const data = path === "/plans/latest" ? plan(current)
      : path === "/plans/latest/meals/1/dinner/options" ? {
        plan_id: 7, day: 1, meal_type: "dinner",
        current: plan(current).days[0].meals[0],
        options: [
          { recipe: CURRY, portions: 1, day_nutrition: nutrition(500), kcal_change: -100, protein_change: 0 },
          { recipe: NOODLES, portions: 1.25, day_nutrition: nutrition(875), kcal_change: 275, protein_change: 8 },
        ],
        total: 2, offset: 0,
      }
      : path === "/plans/latest/grocery" ? { people: 1, items: [], covered: [] }
      : path === "/me" ? { id, email: null, anonymous: true, avatar_url: null,
        limits: { plans_left: 3, plans_per_day: 3, chats_left: 50 } }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], max_minutes: null,
        days: 1, meals: ["dinner"], targets: { kcal: null, min_protein_g: null, max_carbs_g: null },
        pantry: [], cuisines: [], notes: "" }
      : path === "/meta" ? { allergens: [], diets: [], cuisines: [], meal_types: ["dinner"], units: ["g"] }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.getByRole("link", { name: "Meal", exact: true }).first().click()
  await page.getByRole("button", { name: "Change day 1 dinner" }).click()
  await page.getByRole("menuitem", { name: "Swap recipe" }).click()
  await expect(page.getByText("Swap day 1 dinner")).toBeVisible()
}

test("a meal is swapped for one of the safe options and the plan updates", async ({ page }) => {
  const bodies: unknown[] = []
  await openPlan(page, (body) => {
    bodies.push(body)
    return { status: 200, json: null }
  })
  await expect(page.getByText("Peanut Noodles")).toBeVisible()
  await expect(page.getByText("1 from your pantry")).toBeVisible()
  await expect(page.getByText("Day total 500 kcal (−100)")).toBeVisible()
  await expect(page.getByText("Day total 875 kcal (+275) · protein +8 g")).toBeVisible()
  await expect(page.getByText("Showing 2 of 2")).toBeVisible()

  await page.getByRole("button", { name: "Use Chickpea Curry" }).click()
  await expect(page.getByRole("link", { name: /Chickpea Curry/ })).toBeVisible()
  await expect(page.getByRole("link", { name: /Lemon Chicken/ })).toHaveCount(0)
  expect(bodies).toEqual([{ plan_id: 7, recipe_id: "curry" }])
})

test("a swap the server refuses shows why and leaves the plan alone", async ({ page }) => {
  await openPlan(page, () => ({
    status: 422,
    json: { detail: { message: "That recipe does not suit your rules.", problems: ["contains fish"] } },
  }))
  await page.getByRole("button", { name: "Use Peanut Noodles" }).click()
  await expect(page.getByText("That recipe does not suit your rules.")).toBeVisible()
  await expect(page.getByText("contains fish")).toBeVisible()
  await expect(page.getByRole("button", { name: "Use Peanut Noodles" })).toBeEnabled()
})
