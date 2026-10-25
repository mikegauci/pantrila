import { expect, test } from "@playwright/test"

import { account, session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000003"

test("saving an allergy refreshes warnings in an already visited chat", async ({ page }) => {
  let allergies: string[] = []
  await page.addInitScript((user) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    localStorage.setItem(`pantrila-replay:${user}`, "off")
    localStorage.setItem(`pantrila-chat-thread:${user}`, "1")
  }, id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/plans/latest") return route.fulfill({ status: 404, json: {} })
    if (path === "/me/profile" && route.request().method() === "PUT") {
      allergies = route.request().postDataJSON().allergies
    }
    const profile = { allergies, diets: [], exclude_foods: [], max_minutes: null, days: 7,
      meals: ["dinner"], targets: { kcal: null, min_protein_g: null, max_carbs_g: null },
      pantry: [], cuisines: [], notes: "" }
    const now = new Date().toISOString()
    const data = path === "/me/profile" ? profile
      : path === "/meta" ? { allergens: ["peanuts"], diets: [], cuisines: [], meal_types: ["dinner"], units: ["g"] }
      : path === "/me" ? { id, email: null, anonymous: true, avatar_url: null, ...account({ chats: 50 }) }
      : path === "/me/chats" ? [{ id: 1, title: "Snack", messages: 1, updated_at: now }]
      : path === "/me/chats/1" ? { id: 1, title: "Snack", updated_at: now, messages: [
        { role: "assistant", text: "Try a peanut snack.", reply: {
          thread_id: 1, text: "Try a peanut snack.", cited: [], flagged: [], tool_calls: [],
          pantry_changed: false, cost_usd: 0, latency_ms: 1,
          profile_problems: allergies.length ? ["Peanut snack: contains peanuts"] : [],
        } },
      ] }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.getByRole("link", { name: "Assistant", exact: true }).first().click()
  await expect(page.getByText("Try a peanut snack.")).toBeVisible()
  await expect(page.getByText("Peanut snack: contains peanuts")).toHaveCount(0)
  await page.getByRole("link", { name: "Profile", exact: true }).first().click()
  await page.getByRole("button", { name: "Peanuts", exact: true }).click()
  await page.getByRole("button", { name: "Save profile", exact: true }).click()
  await expect(page.getByText("Profile saved", { exact: true })).toBeVisible()
  await page.getByRole("link", { name: "Assistant", exact: true }).first().click()
  await expect(page.getByText("Peanut snack: contains peanuts")).toBeVisible()
})
