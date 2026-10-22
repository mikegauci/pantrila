import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000041"

test.use({ viewport: { width: 390, height: 844 } })

test("the energy target can be a range, prefilled from the single number", async ({ page }) => {
  const saved: { targets: Record<string, number | null> }[] = []
  const profile = { allergies: [], diets: [], exclude_foods: [], max_minutes: null, days: 3,
    meals: ["breakfast", "dinner"], targets: { kcal: 2000, min_kcal: null, max_kcal: null,
      min_protein_g: null, max_carbs_g: null }, pantry: [], cuisines: [], notes: "" }
  await page.addInitScript((user) => localStorage.setItem(`pantrila-tour-done:${user}`, "1"), id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (path === "/me/profile" && request.method() === "PUT") {
      saved.push(request.postDataJSON())
      return route.fulfill({ json: request.postDataJSON() })
    }
    const data = path === "/me/profile" ? profile
      : path === "/me" ? { id, email: null, anonymous: true, avatar_url: null,
        limits: { plans_left: 3, plans_per_day: 3, chats_left: 50 } }
      : path === "/meta" ? { allergens: [], diets: [], cuisines: [], meal_types: ["breakfast", "dinner"], units: ["g"] }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await expect(page).not.toHaveURL(/login/)
  await page.goto("/profile")

  await expect(page.getByLabel("Energy (kcal)")).toHaveValue("2000")
  await page.getByRole("radio", { name: "A range" }).click()
  await expect(page.getByLabel("At least (kcal)")).toHaveValue("1800")
  await expect(page.getByLabel("At most (kcal)")).toHaveValue("2200")
  await page.getByLabel("At most (kcal)").fill("")
  await expect(page.getByText("Leave one end blank for only a floor or a ceiling.")).toBeVisible()
  await page.getByRole("button", { name: "Save profile" }).click()
  await expect.poll(() => saved.length).toBe(1)
  expect(saved[0].targets).toMatchObject({ kcal: null, min_kcal: 1800, max_kcal: null })
})
