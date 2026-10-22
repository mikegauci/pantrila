import { expect, test, type Page } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000031"

test.use({ viewport: { width: 390, height: 844 } })

const nutrition = (kcal: number) => ({ kcal, protein_g: 30, carbs_g: 40, fat_g: 10, fibre_g: 5 })
const card = (rid: string, title: string, kcal: number) => ({
  id: rid, title, summary: "", cuisine: "greek", meal_types: ["dinner"], diet_tags: [],
  allergens: [], total_minutes: 30, servings: 2, nutrition: nutrition(kcal), ingredient_count: 5,
  pantry_foods: [], problems: [], photo_url: null,
})
const CHICKEN = card("chicken", "Lemon Chicken", 600)
const CURRY = card("curry", "Chickpea Curry", 500)
const TOAST = card("mine-5", "Grandma's Toast", 400)
const report = {
  model: "m", warnings: [], first_draft_problems: [], repairs: 0, fallbacks: 0, pantry_use: 1,
  path: [], llm_calls: 1, tool_calls: 1, input_tokens: 1, output_tokens: 1, cost_usd: 0.01,
  latency_ms: 1000,
}

type Meal = {
  meal_type: string; portions: number; recipe: ReturnType<typeof card> | null; kind: string
  cookbook_id: number | null; from_day: number | null; from_meal: string | null; out_kcal: number | null
}
const meal = (recipe: ReturnType<typeof card>): Meal => ({
  meal_type: "dinner", portions: 1, recipe, kind: "recipe", cookbook_id: null, from_day: null,
  from_meal: null, out_kcal: null,
})

/** A fake API holding a two-day plan of dinners; slot and swap requests change it. */
async function openPlan(page: Page, requests: { path: string; body: unknown }[]) {
  const days: Meal[] = [meal(CHICKEN), meal(CURRY)]
  const plan = () => ({
    id: 7, created_at: new Date().toISOString(), notes: "", problems: [], report,
    targets: { kcal: null, min_protein_g: null, max_carbs_g: null },
    days: days.map((m, i) => ({ day: i + 1, nutrition: nutrition(m.out_kcal ?? 0), meals: [m] })),
  })
  await page.addInitScript((user) => localStorage.setItem(`pantrila-tour-done:${user}`, "1"), id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    const slot = path.match(/^\/plans\/latest\/meals\/(\d)\/dinner(\/slot|\/repeat)?$/)
    if (slot && request.method() === "PUT") {
      const body = request.postDataJSON()
      requests.push({ path, body })
      const i = Number(slot[1]) - 1
      if (slot[2] === "/repeat") {
        for (const t of body.on) {
          days[t.day - 1] = { ...days[t.day - 1], kind: "leftovers", recipe: days[i].recipe,
            from_day: i + 1, from_meal: "dinner" }
        }
      } else if (slot[2]) {
        const from = body.kind === "leftovers" ? days[body.from_day - 1].recipe : days[i].recipe
        days[i] = { ...days[i], kind: body.kind, recipe: from, out_kcal: body.out_kcal ?? null,
          from_day: body.from_day ?? null, from_meal: body.from_meal ?? null }
      } else {
        days[i] = { ...meal(TOAST), cookbook_id: 5 }
      }
      return route.fulfill({ json: plan() })
    }
    if (path.endsWith("/options")) {
      requests.push({ path: `${path}?${url.searchParams}`, body: null })
      const mine = url.searchParams.get("source") === "mine"
      const options = mine ? [TOAST] : [CURRY]
      return route.fulfill({ json: {
        plan_id: 7, day: 1, meal_type: "dinner", current: days[0], total: options.length, offset: 0,
        options: options.map((r) => ({ recipe: r, portions: 1, day_nutrition: nutrition(r.nutrition.kcal),
          kcal_change: -100, protein_change: 0 })),
      } })
    }
    const data = path === "/plans/latest" ? plan()
      : path === "/plans/latest/grocery" ? { people: 1, items: [], covered: [], unlisted: [] }
      : path === "/me" ? { id, email: null, anonymous: true, avatar_url: null,
        limits: { plans_left: 3, plans_per_day: 3, chats_left: 50 } }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], max_minutes: null,
        days: 2, meals: ["dinner"], targets: { kcal: null, min_protein_g: null, max_carbs_g: null },
        pantry: [], cuisines: [], notes: "" }
      : path === "/meta" ? { allergens: [], diets: [], cuisines: [], meal_types: ["dinner"], units: ["g"] }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.getByRole("link", { name: "Meal", exact: true }).first().click()
  await expect(page.getByRole("link", { name: /Lemon Chicken/ })).toBeVisible()
}

/** Open a meal's menu, pick an item, and wait for that menu to finish closing, so the next
 * menu opened is the only one on the page. */
async function choose(page: Page, slot: string, item: string | RegExp) {
  await page.getByRole("button", { name: `Change ${slot}` }).click()
  const menu = page.getByRole("menu", { name: `Change ${slot}` })
  await menu.getByRole("menuitem", { name: item }).click()
  await expect(menu).toHaveCount(0)
}

test("a meal can be leftovers of an earlier day, which then stays cooked", async ({ page }) => {
  const requests: { path: string; body: unknown }[] = []
  await openPlan(page, requests)
  await choose(page, "day 2 dinner", /Lemon Chicken/)
  await expect(page.getByText("Leftovers from day 1")).toBeVisible()
  expect(requests.at(-1)).toEqual({ path: "/plans/latest/meals/2/dinner/slot",
    body: { plan_id: 7, kind: "leftovers", from_day: 1, from_meal: "dinner" } })

  await page.getByRole("button", { name: "Change day 1 dinner" }).click()
  const menu = page.getByRole("menu", { name: "Change day 1 dinner" })
  await expect(menu.getByText("Day 2 dinner is leftovers of this meal, so it stays cooked.")).toBeVisible()
  await expect(menu.getByRole("menuitem", { name: "Skip this meal" })).toHaveAttribute("aria-disabled", "true")
})

test("a meal can be skipped, eaten out and added back", async ({ page }) => {
  const requests: { path: string; body: unknown }[] = []
  await openPlan(page, requests)
  await choose(page, "day 1 dinner", "Skip this meal")
  await expect(page.getByText("Was Lemon Chicken")).toBeVisible()
  await expect(page.getByRole("main").getByText("Skipped", { exact: true })).toBeVisible()

  await choose(page, "day 1 dinner", /Normal meal/)
  await expect(page.getByRole("main").getByText("Eating out", { exact: true })).toBeVisible()
  await expect(page.getByRole("main").getByText("~800 kcal", { exact: true })).toBeVisible()
  expect(requests.at(-1)?.body).toEqual({ plan_id: 7, kind: "eating_out", out_kcal: 800 })

  await choose(page, "day 1 dinner", "Add back Lemon Chicken")
  await expect(page.getByRole("link", { name: /Lemon Chicken/ })).toBeVisible()
  expect(requests.at(-1)?.body).toEqual({ plan_id: 7, kind: "recipe" })
})

test("the swap sheet searches and can use one of the person's own recipes", async ({ page }) => {
  const requests: { path: string; body: unknown }[] = []
  await openPlan(page, requests)
  await choose(page, "day 1 dinner", "Swap recipe")
  await expect(page.getByRole("dialog").getByText("Chickpea Curry")).toBeVisible()
  await page.getByRole("textbox", { name: "Search recipes" }).fill("curry")
  await expect.poll(() => requests.some((r) => r.path.includes("q=curry"))).toBe(true)

  await page.getByRole("tab", { name: "My recipes" }).click()
  await page.getByRole("button", { name: "Use Grandma's Toast" }).click()
  await expect(page.getByRole("link", { name: /Grandma's Toast/ })).toHaveAttribute("href", "/recipes/mine/5")
  await expect(page.getByText("Your recipe")).toBeVisible()
  expect(requests.some((r) => r.path.includes("source=mine"))).toBe(true)
  expect(requests.find((r) => r.path === "/plans/latest/meals/1/dinner")?.body)
    .toEqual({ plan_id: 7, recipe_id: "mine-5" })
})

test("a meal is repeated on a later day and cooking mode gets the extra servings", async ({ page }) => {
  const requests: { path: string; body: unknown }[] = []
  await openPlan(page, requests)
  await choose(page, "day 1 dinner", "Repeat on other days")
  const sheet = page.getByRole("dialog")
  await expect(sheet.getByText("Repeat Lemon Chicken")).toBeVisible()
  await expect(sheet.getByText("Instead of Chickpea Curry")).toBeVisible()
  await sheet.getByRole("checkbox", { name: /Day 2 dinner/ }).click()
  await expect(sheet.getByText("Cook once, eat 2 times.")).toBeVisible()
  await sheet.getByRole("button", { name: "Repeat on 1 meal" }).click()
  await expect(page.getByText("Leftovers for day 2")).toBeVisible()
  await expect(page.getByText("Leftovers from day 1")).toBeVisible()
  expect(requests.at(-1)).toEqual({ path: "/plans/latest/meals/1/dinner/repeat",
    body: { plan_id: 7, on: [{ day: 2, meal_type: "dinner" }] } })

  await choose(page, "day 1 dinner", /Start cooking/)
  await expect(page).toHaveURL(/\/recipes\/chicken\/cook\?servings=2&later=1$/)
})
