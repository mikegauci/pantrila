import { expect, test } from "@playwright/test"

import { account, session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000031"

test("a Free cap opens Get Pantrila Pro in the app, and Profile shows the plan", async ({ page }) => {
  await page.addInitScript((user) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    localStorage.setItem(`pantrila-replay:${user}`, "off")
  }, id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/plans/latest") return route.fulfill({ status: 404, json: {} })
    if (path === "/plans" && route.request().method() === "POST") {
      return route.fulfill({ status: 402, json: {
        detail: "Pantrila Free includes 1 meal plan a week, and it is used. Pantrila Pro gives you more.",
        code: "pro_required", feature: "plan", resets_at: "2026-10-26T00:00:00+00:00" } })
    }
    const free = account({ plans: 0 }, "free")
    free.limits.plans = { limit: 1, left: 0, window: "week", resets_at: "2026-10-26T00:00:00+00:00" }
    free.limits.photos = { ...free.limits.photos, limit: 0, left: 0 }
    const data = path === "/me" ? { id, email: null, anonymous: true, avatar_url: null, ...free }
      : path === "/me/profile" ? { allergies: [], diets: [], exclude_foods: [], pantry: [], days: 7,
        meals: ["dinner"], targets: { kcal: 2000, min_protein_g: null, max_carbs_g: null },
        max_minutes: null, cuisines: [], notes: "" }
      : path === "/meta" ? { allergens: [], diets: [], cuisines: [], meal_types: ["dinner"], units: ["g"] }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.getByRole("link", { name: "Meal plan", exact: true }).first().click()
  await expect(page.getByText("0 of 1 plan left this week.")).toBeVisible()
  // On Free the button stays on: a click explains Pro instead of doing nothing.
  await page.getByRole("button", { name: "Plan my week", exact: true }).click()
  const sheet = page.getByRole("dialog", { name: "Get Pantrila Pro in the app" })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText("You have used this week's free meal plan.")).toBeVisible()
  await expect(sheet.getByText("€4.99 a month or €29.99 a year")).toBeVisible()
  await sheet.getByRole("button", { name: "Not now" }).click()
  await expect(sheet).toBeHidden()

  await page.goto("/profile")
  await expect(page.getByText("Pantrila Free", { exact: true })).toBeVisible()
  await expect(page.getByText("No photos on Free")).toBeVisible()
  await expect(page.getByText("cancel it in your phone's settings first")).toBeVisible()
})
