import { expect, test } from "@playwright/test"

import { session } from "./helpers"

const id = "00000000-0000-4000-8000-000000000009"

test("deleting the account asks for confirmation, calls DELETE /me and signs out", async ({ page }) => {
  let deleted = false
  await page.addInitScript((user) => {
    localStorage.setItem(`pantrila-tour-done:${user}`, "1")
    localStorage.setItem(`pantrila-replay:${user}`, "off")
    localStorage.setItem(`pantrila-cook:${user}:corpus:x`, "{}")
  }, id)
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
    if (path === "/me" && route.request().method() === "DELETE") {
      deleted = true
      return route.fulfill({ status: 204 })
    }
    if (path === "/plans/latest") return route.fulfill({ status: 404, json: {} })
    const profile = { allergies: [], diets: [], exclude_foods: [], max_minutes: null, days: 7,
      meals: ["dinner"], targets: { kcal: null, min_protein_g: null, max_carbs_g: null },
      pantry: [], cuisines: [], notes: "" }
    const data = path === "/me/profile" ? profile
      : path === "/meta" ? { allergens: [], diets: [], cuisines: [], meal_types: ["dinner"], units: ["g"] }
      : path === "/me" ? { id, email: null, anonymous: true, avatar_url: null, limits: {} }
      : path === "/health" ? { ok: true } : []
    await route.fulfill({ json: data })
  })
  await page.goto("/login")
  await page.getByRole("button", { name: "Try it as a guest" }).click()
  await page.getByRole("link", { name: "Profile", exact: true }).first().click()
  await page.getByRole("button", { name: "Delete my account" }).click()
  const confirm = page.getByRole("button", { name: "Delete everything" })
  await expect(confirm).toBeDisabled()
  await page.getByLabel("Type delete to confirm").fill("delete")
  await confirm.click()
  await expect(page.getByText("Your account and everything in it are deleted.")).toBeVisible()
  await expect(page).toHaveURL(/\/login/)
  expect(deleted).toBe(true)
  expect(await page.evaluate((user) => Object.keys(localStorage).filter((k) => k.includes(user)), id)).toEqual([])
})
