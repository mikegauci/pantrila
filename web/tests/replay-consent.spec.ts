import { expect, test, type Page } from "@playwright/test"

import { session } from "./helpers"

// PostHog drops traffic from headless browsers as bots, so look like an ordinary Chrome.
test.use({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36" })

async function signIn(page: Page, id: string, ingest: string[]) {
  await page.addInitScript((user) => localStorage.setItem(`pantrila-tour-done:${user}`, "1"), id)
  await page.route("**/ingest/**", async (route) => {
    ingest.push(route.request().url())
    await route.fulfill({ status: 200, json: {} })
  })
  await page.route("http://127.0.0.1:54321/**", (route) => route.fulfill({ json: session(id) }))
  await page.route("http://127.0.0.1:8000/**", async (route) => {
    const path = new URL(route.request().url()).pathname
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
}

test("nothing is recorded until the person says yes, and No is remembered", async ({ page }) => {
  const ingest: string[] = []
  await signIn(page, "00000000-0000-4000-8000-000000000011", ingest)
  const banner = page.getByRole("dialog", { name: "Help improve Pantrila?" })
  await expect(banner).toBeVisible()
  await expect(banner).toContainText("Anything you type is hidden")
  await banner.getByRole("button", { name: "No thanks" }).click()
  await expect(banner).toBeHidden()
  await page.reload()
  await page.waitForTimeout(2500)
  await expect(banner).toBeHidden()
  expect(ingest).toEqual([])
})

test("saying yes starts replay, and Profile can turn it off", async ({ page }) => {
  const ingest: string[] = []
  await signIn(page, "00000000-0000-4000-8000-000000000012", ingest)
  await page.getByRole("button", { name: "Yes, record my visits" }).click()
  await expect.poll(() => ingest.length).toBeGreaterThan(0)
  await page.getByRole("link", { name: "Profile", exact: true }).first().click()
  const toggle = page.getByRole("switch", { name: "Record my visits" })
  await expect(toggle).toBeChecked()
  await toggle.click()
  await expect(toggle).not.toBeChecked()
  expect(await page.evaluate(() => localStorage.getItem("pantrila-replay:00000000-0000-4000-8000-000000000012")))
    .toBe("off")
})
