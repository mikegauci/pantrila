import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000005"

test("an interrupted plan stream shows a failure instead of silently finishing", async ({ page }) => {
  let requests = 0
  await page.addInitScript((user) => localStorage.setItem(`pantrila-tour-done:${user}`, "1"), id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/plans/latest") return route.fulfill({ status: 404, json: {} })
    if (path === "/plans" && route.request().method() === "POST") {
      requests++
      return route.fulfill({ contentType: "text/event-stream",
        body: ': keep-alive\n\nevent: step\ndata: {"node":"retrieve"}\n\n' })
    }
    const data = path === "/me" ? { id, email: null, anonymous: true, avatar_url: null,
      limits: { plans_left: 5, plans_per_day: 5, chats_left: 50 } }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [], days: 7,
        meals: ["dinner"], targets: { kcal: 2000, min_protein_g: null, max_carbs_g: null },
        max_minutes: null, cuisines: [], notes: "" }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.getByRole("link", { name: "Meal plan", exact: true }).first().click()
  await page.getByRole("button", { name: "Plan my week", exact: true }).click()
  await expect(page.getByRole("alert").filter({ hasText: "disconnected" })).toBeVisible()
  await expect(page.getByRole("button", { name: "Plan my week", exact: true })).toBeEnabled()
  expect(requests).toBe(1)
})
