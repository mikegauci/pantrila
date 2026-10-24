import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000004"
const nutrition = { kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 10, fibre_g: 0 }
const initial = {
  title: "Butter cake", summary: "A cake", cuisine: "british", meal_types: ["snack"],
  total_minutes: 30, servings: 2,
  ingredients: [{ name: "butter", food: "butter", quantity: 30, unit: "g", estimate: null }],
  steps: ["Mix.", "Bake."], source: "manual", source_url: null,
}

test("draft warnings remain visible and the reviewed recipe can be edited and saved", async ({ page }) => {
  let saved = initial
  let created = false
  await page.addInitScript((user) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    localStorage.setItem(`pantrila-replay:${user}`, "off")
  }, id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    const now = new Date().toISOString()
    if (path === "/me/recipes/preview" && route.request().postDataJSON().ingredients[0].quantity <= 0) {
      return route.fulfill({ status: 422, json: { detail: "Amount must be greater than zero" } })
    }
    if (path === "/plans/latest") return route.fulfill({ status: 404, json: {} })
    if (path === "/me/recipes" && route.request().method() === "POST") {
      saved = route.request().postDataJSON()
      created = true
    }
    const detail = { ...saved, id: 7, recipe: saved, created_at: now, updated_at: now,
      ingredient_count: 1, nutrition, allergens: ["milk"], diet_tags: ["vegetarian"],
      estimated: false, invalid: [], pantry_foods: [], problems: ["contains milk"], photo_url: null,
      ingredients: saved.ingredients.map((line) => ({ ...line, grams: 30, in_pantry: false })),
    }
    const reply = { thread_id: 1, text: "Here is a cake.", cited: [], flagged: [], tool_calls: [],
      pantry_changed: false, cost_usd: 0, latency_ms: 1, profile_problems: [], drafts: [initial],
      draft_problems: [["contains milk"]] }
    if (path === "/chat/stream") {
      const events = [["step", { label: "Writing your recipe…" }], ["delta", { text: reply.text }], ["reply", reply]]
      return route.fulfill({ contentType: "text/event-stream",
        body: events.map(([kind, d]) => `event: ${kind}\ndata: ${JSON.stringify(d)}\n\n`).join("") })
    }
    const data = path === "/me" ? { id, email: null, avatar_url: null, anonymous: true,
      limits: { chats_left: 50, photos_left: 5, photos_per_day: 5 } }
      : path === "/me/profile" ? { allergies: ["milk"], diets: [], exclude_foods: [], pantry: [],
        days: 7, meals: ["dinner"], max_minutes: null, cuisines: [], notes: "", targets: {} }
      : path === "/foods" ? [{ key: "butter", name: "butter", aisle: "dairy" }]
      : path === "/me/chats/1" ? { id: 1, title: "Cake", updated_at: now,
        messages: [{ role: "assistant", text: reply.text, reply }] }
      : path === "/me/recipes/preview" ? { ingredients: [], nutrition, allergens: ["milk"],
        diet_tags: ["vegetarian"], estimated: false, problems: ["contains milk"] }
      : path === "/me/recipes" && route.request().method() === "GET" ? (created ? [detail] : [])
      : path === "/me/recipes/7" || path === "/me/recipes/7/photo" || path === "/me/recipes" ? detail
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.getByRole("link", { name: "Assistant", exact: true }).first().click()
  await page.getByRole("textbox", { name: "Message", exact: true }).fill("Write me a cake")
  await page.getByRole("button", { name: "Send", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "Check Butter cake" })).toContainText("contains milk")
  await page.getByRole("button", { name: "Save “Butter cake” to My recipes" }).click()
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("Butter cake")
  await page.getByLabel("Title", { exact: true }).fill("Family cake")
  await expect(page.getByRole("figure", { name: "100 kcal", exact: true })).toBeVisible()
  await page.getByRole("spinbutton", { name: "Amount for ingredient 1" }).fill("0")
  await expect(page.getByRole("figure", { name: "100 kcal", exact: true })).toHaveCount(0)
  await expect(page.getByText("Amount must be greater than zero", { exact: true })).toBeVisible()
  await page.getByRole("spinbutton", { name: "Amount for ingredient 1" }).fill("30")
  await page.getByRole("button", { name: "Save to my recipes", exact: true }).click()
  await expect(page).toHaveURL(/\/recipes\/mine\/7\?chat=1$/)
  await expect(page.getByRole("heading", { name: "Family cake", exact: true })).toBeVisible()
  expect(saved.title).toBe("Family cake")
  expect((saved as { chat_draft?: string }).chat_draft).toMatch(/^1:[0-9a-f]{8}$/)
  // Back in the chat, the draft shows as saved instead of offering Save again.
  await page.getByRole("link", { name: "Back to the chat" }).click()
  await expect(page).toHaveURL(/\/assistant/)
  await expect(page.getByRole("link", { name: "Saved to My recipes as “Family cake”" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Save “Butter cake” to My recipes" })).toHaveCount(0)
})
